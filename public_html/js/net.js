/*
 * NQ Chopper online transport.
 *
 * Preferred path: a WebRTC data channel between the two browsers, negotiated
 * through Laravel with ordinary HTTP requests and short polling (offer /
 * answer / ICE candidates), using STUN plus TURN servers from the page config.
 *
 * Fallback path: if ICE fails (symmetric NAT, locked-down Wi-Fi, no TURN
 * reachable), both peers switch to relaying their lockstep messages through
 * the server with a single combined post-and-poll request every ~100 ms.
 * Higher latency, but it connects anywhere the website itself loads.
 */
(function (root) {
    'use strict';

    const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const RELAY_INTERVAL = 100;      // ms between relay round-trips
    const P2P_TIMEOUT = 25000;       // ms to wait for ICE before falling back

    function createLink(opts) {
        const { role, urls, csrf } = opts;
        const onStatus = opts.onStatus || (() => {});
        const iceServers = Array.isArray(opts.ice) && opts.ice.length ? opts.ice : DEFAULT_ICE;
        let pc = null, channel = null, lastSignalId = 0, polling = null, closed = false, opened = false;
        let transport = null;        // 'p2p' | 'relay'
        let opponent = opts.opponent || null;
        let p2pStarted = 0, fallbackTimer = null;
        const outbox = [];           // relay-mode queue
        let relayLast = 0, relayBusy = false, relayTimer = null, relayFailures = 0;

        async function post(url, body) {
            const r = await fetch(url, { method: 'POST', credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'X-CSRF-TOKEN': csrf },
                body: JSON.stringify(body) });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }
        async function get(url) {
            const r = await fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
            if (!r.ok) throw new Error('HTTP ' + r.status);
            return r.json();
        }
        const signal = (type, payload) => post(urls.signal, { type, payload: JSON.stringify(payload) }).catch(() => {});

        function stopPolling() { if (polling) { clearTimeout(polling); polling = null; } }
        function fail(msg) {
            if (closed) return;
            closed = true;
            stopPolling();
            if (relayTimer) { clearTimeout(relayTimer); relayTimer = null; }
            if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
            onStatus(msg, 'error');
            if (opts.onClose) opts.onClose(msg);
        }
        function deliver(obj) { if (opts.onMessage) { try { opts.onMessage(obj); } catch (e) { /* ignore */ } } }
        function becomeOpen(kind) {
            if (opened || closed) return;
            opened = true; transport = kind;
            stopPolling();
            if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null; }
            onStatus(kind === 'p2p' ? 'CONNECTED (DIRECT)' : 'CONNECTED VIA SERVER RELAY', 'ok');
            if (opts.onOpen) opts.onOpen(kind);
        }

        // ------------------------------------------------------------------
        // WebRTC
        // ------------------------------------------------------------------
        function setupPeer() {
            if (typeof RTCPeerConnection === 'undefined') { startRelay('NO WEBRTC IN THIS BROWSER'); return false; }
            try { pc = new RTCPeerConnection({ iceServers }); } catch (e) { startRelay('WEBRTC UNAVAILABLE'); return false; }
            p2pStarted = Date.now();
            pc.onicecandidate = e => { if (e.candidate) signal('candidate', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); };
            pc.oniceconnectionstatechange = () => {
                if (!pc) return;
                if (pc.iceConnectionState === 'checking' && !opened) onStatus('CONNECTING... (ICE)');
                if (pc.iceConnectionState === 'failed') { if (!opened || transport === 'p2p') startRelay('DIRECT CONNECTION FAILED'); }
            };
            pc.onconnectionstatechange = () => {
                if (!pc) return;
                if (pc.connectionState === 'failed') { if (transport !== 'relay') startRelay('DIRECT CONNECTION FAILED'); }
                else if ((pc.connectionState === 'disconnected' || pc.connectionState === 'closed') && transport === 'p2p') fail('OPPONENT DISCONNECTED');
            };
            pc.ondatachannel = e => bindChannel(e.channel);
            if (!fallbackTimer) fallbackTimer = setTimeout(() => { if (!opened) startRelay('DIRECT CONNECTION TIMED OUT'); }, P2P_TIMEOUT);
            return true;
        }
        function bindChannel(ch) {
            channel = ch;
            ch.onopen = () => becomeOpen('p2p');
            ch.onclose = () => { if (transport === 'p2p') fail('OPPONENT DISCONNECTED'); };
            ch.onmessage = e => { try { deliver(JSON.parse(e.data)); } catch (err) { /* ignore junk */ } };
        }
        async function hostOffer() {
            if (!setupPeer()) return;
            bindChannel(pc.createDataChannel('game', { ordered: true }));
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            await signal('offer', pc.localDescription);
            onStatus('CONNECTING TO ' + (opponent ? opponent.name.toUpperCase() : 'OPPONENT') + '...');
        }
        const pendingCandidates = [];
        async function flushCandidates() { for (const c of pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {}); }
        async function handleSignal(sig) {
            let payload; try { payload = JSON.parse(sig.payload); } catch (e) { return; }
            if (sig.type === 'relay-mode') { startRelay('OPPONENT REQUESTED SERVER RELAY'); return; }
            if (transport === 'relay') return;
            if (sig.type === 'offer' && role === 'guest') {
                if (!pc && !setupPeer()) return;
                await pc.setRemoteDescription(payload);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await signal('answer', pc.localDescription);
                await flushCandidates();
                onStatus('CONNECTING...');
            } else if (sig.type === 'answer' && role === 'host' && pc) {
                if (!pc.currentRemoteDescription) { await pc.setRemoteDescription(payload); await flushCandidates(); }
            } else if (sig.type === 'candidate') {
                if (pc && pc.remoteDescription) await pc.addIceCandidate(payload).catch(() => {});
                else pendingCandidates.push(payload);
            } else if (sig.type === 'bye') {
                fail('OPPONENT LEFT');
            }
        }

        // ------------------------------------------------------------------
        // Signalling poll (until a transport is open)
        // ------------------------------------------------------------------
        let waitingForGuest = role === 'host' && !opponent;
        let offered = false;
        async function poll() {
            if (closed || opened) return;
            try {
                if (waitingForGuest) {
                    const st = await get(urls.status);
                    if (st.guest) { waitingForGuest = false; opponent = st.guest; if (opts.onOpponent) opts.onOpponent(opponent); }
                }
                if (!waitingForGuest) {
                    if (role === 'host' && !offered) { offered = true; await hostOffer(); }
                    const res = await get(urls.signals + '?after=' + lastSignalId);
                    for (const sig of res.signals) { lastSignalId = Math.max(lastSignalId, sig.id); await handleSignal(sig); }
                }
            } catch (e) {
                onStatus('SIGNALLING ERROR, RETRYING...', 'warn');
            }
            if (!closed && !opened) polling = setTimeout(poll, waitingForGuest ? 1500 : 700);
        }

        // ------------------------------------------------------------------
        // Server relay fallback
        // ------------------------------------------------------------------
        function startRelay(reason) {
            if (closed || transport === 'relay') return;
            if (transport === 'p2p') { try { channel && channel.close(); } catch (e) { /* ignore */ } }
            if (pc) { try { pc.close(); } catch (e) { /* ignore */ } pc = null; }
            channel = null;
            onStatus((reason ? reason + ' - ' : '') + 'SWITCHING TO SERVER RELAY', 'warn');
            // Tell the other side to do the same (idempotent on their end)
            signal('relay-mode', { reason: reason || '' });
            transport = 'relay';
            opened = false;
            relayTick();
            becomeOpen('relay');
        }
        async function relayTick() {
            if (closed || transport !== 'relay') return;
            if (!relayBusy) {
                relayBusy = true;
                const batch = outbox.splice(0, 200);
                try {
                    const res = await post(urls.relay, { after: relayLast, msgs: batch });
                    relayFailures = 0;
                    relayLast = Math.max(relayLast, res.last || 0);
                    for (const m of res.msgs) deliver(m);
                    if (res.status === 'finished' && opts.onFinishedRemotely) opts.onFinishedRemotely();
                } catch (e) {
                    outbox.unshift(...batch);
                    if (++relayFailures > 50) { fail('LOST CONTACT WITH SERVER'); return; }
                    if (relayFailures === 5) onStatus('RELAY HICCUP, RETRYING...', 'warn');
                }
                relayBusy = false;
            }
            relayTimer = setTimeout(relayTick, RELAY_INTERVAL);
        }

        onStatus(waitingForGuest ? 'WAITING FOR AN OPPONENT' : (role === 'guest' ? 'WAITING FOR HOST...' : 'CONNECTING...'));
        poll();
        window.addEventListener('beforeunload', () => {
            if (closed) return;
            try { navigator.sendBeacon && navigator.sendBeacon(urls.signal, new Blob([JSON.stringify({ type: 'bye', payload: '{}', _token: csrf })], { type: 'application/json' })); } catch (e) { /* ignore */ }
        });

        return {
            send(obj) {
                if (transport === 'relay') { outbox.push(obj); return true; }
                if (channel && channel.readyState === 'open') { try { channel.send(JSON.stringify(obj)); return true; } catch (e) { return false; } }
                return false;
            },
            close() { closed = true; stopPolling(); if (relayTimer) clearTimeout(relayTimer); try { channel && channel.close(); pc && pc.close(); } catch (e) { /* ignore */ } },
            get open() { return opened && !closed; },
            get transport() { return transport; },
            get opponent() { return opponent; }
        };
    }

    root.NQNet = { createLink };
})(window);

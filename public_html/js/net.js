/*
 * NQ Chopper online transport.
 *
 * Direct peer-to-peer is always preferred: a WebRTC data channel negotiated
 * through Laravel (offer / answer / ICE candidates over HTTP polling) using
 * STUN plus TURN servers from the page config, with ICE restarts if the first
 * attempt fails.
 *
 * If the direct link is not up after RELAY_AFTER ms, the game starts a server
 * relay so the match can begin, but keeps negotiating in the background and
 * upgrades to the data channel as soon as it opens. Messages are sent on the
 * best transport available and accepted from either; the lockstep protocol is
 * idempotent per frame, so duplicates during a switch are harmless.
 */
(function (root) {
    'use strict';

    const DEFAULT_ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
    const RELAY_INTERVAL = 100;   // ms between relay round-trips
    const RELAY_AFTER = 12000;    // ms without a direct link before the relay starts (P2P keeps trying)
    const ICE_RETRY_EVERY = 15000; // ms between ICE restart attempts
    const MAX_ICE_RESTARTS = 3;
    const RELAY_DRAIN = 3000;     // ms to keep polling the relay after the direct link opens

    function createLink(opts) {
        const { role, urls, csrf } = opts;
        const onStatus = opts.onStatus || (() => {});
        const iceServers = Array.isArray(opts.ice) && opts.ice.length ? opts.ice : DEFAULT_ICE;
        let pc = null, channel = null, lastSignalId = 0, polling = null, closed = false;
        let channelOpen = false, relayActive = false, everOpened = false;
        let opponent = opts.opponent || null;
        let iceRestarts = 0, lastIceAttempt = 0, p2pGaveUp = false, relayTimerStart = null;
        const outbox = [];
        let relayLast = 0, relayBusy = false, relayTimer = null, relayFailures = 0, relayDrainUntil = 0;
        const pendingCandidates = [];

        const transport = () => channelOpen ? 'p2p' : relayActive ? 'relay' : null;

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
            if (relayTimerStart) { clearTimeout(relayTimerStart); relayTimerStart = null; }
            onStatus(msg, 'error');
            if (opts.onClose) opts.onClose(msg);
        }
        function deliver(obj) { if (opts.onMessage) { try { opts.onMessage(obj); } catch (e) { /* ignore */ } } }
        function announce(kind) {
            const first = !everOpened; everOpened = true;
            onStatus(kind === 'p2p' ? (first ? 'CONNECTED (DIRECT)' : 'UPGRADED TO DIRECT CONNECTION') : 'CONNECTED VIA SERVER RELAY (STILL TRYING DIRECT)', kind === 'p2p' ? 'ok' : 'warn');
            if (opts.onTransport) opts.onTransport(kind);
            if (first && opts.onOpen) opts.onOpen(kind);
        }

        // ------------------------------------------------------------------
        // WebRTC (always attempted, retried, and preferred)
        // ------------------------------------------------------------------
        function setupPeer() {
            if (typeof RTCPeerConnection === 'undefined') { p2pGaveUp = true; startRelay('NO WEBRTC IN THIS BROWSER'); return false; }
            try { pc = new RTCPeerConnection({ iceServers, iceCandidatePoolSize: 2 }); } catch (e) { p2pGaveUp = true; startRelay('WEBRTC UNAVAILABLE'); return false; }
            lastIceAttempt = Date.now();
            pc.onicecandidate = e => { if (e.candidate) signal('candidate', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); };
            pc.oniceconnectionstatechange = () => {
                if (!pc || closed) return;
                const st = pc.iceConnectionState;
                if (st === 'checking' && !everOpened) onStatus('CONNECTING DIRECTLY... (ICE)');
                if (st === 'failed') retryIce('ICE FAILED');
            };
            pc.onconnectionstatechange = () => {
                if (!pc || closed) return;
                if (pc.connectionState === 'failed') retryIce('CONNECTION FAILED');
            };
            pc.ondatachannel = e => bindChannel(e.channel);
            if (!relayTimerStart && !relayActive) relayTimerStart = setTimeout(() => { if (!channelOpen) startRelay('DIRECT LINK NOT UP YET'); }, RELAY_AFTER);
            return true;
        }
        function bindChannel(ch) {
            channel = ch;
            ch.onopen = () => {
                channelOpen = true;
                stopPolling();
                // Anything still queued for the relay goes straight down the channel instead
                for (const m of outbox.splice(0)) { try { ch.send(JSON.stringify(m)); } catch (e) { /* ignore */ } }
                if (relayActive) relayDrainUntil = Date.now() + RELAY_DRAIN;
                announce('p2p');
            };
            ch.onclose = () => {
                if (closed) return;
                if (channelOpen) {
                    channelOpen = false;
                    // Direct link dropped mid-match: fall back to the relay and keep playing
                    onStatus('DIRECT LINK LOST - USING SERVER RELAY', 'warn');
                    startRelay(null, true);
                    if (opts.onTransport) opts.onTransport('relay');
                    scheduleReconnect();
                }
            };
            ch.onmessage = e => { try { deliver(JSON.parse(e.data)); } catch (err) { /* ignore junk */ } };
        }
        async function hostOffer(restart) {
            if (!pc && !setupPeer()) return;
            if (!restart) bindChannel(pc.createDataChannel('game', { ordered: true }));
            const offer = await pc.createOffer(restart ? { iceRestart: true } : {});
            await pc.setLocalDescription(offer);
            await signal('offer', pc.localDescription);
            if (!everOpened) onStatus('CONNECTING TO ' + (opponent ? opponent.name.toUpperCase() : 'OPPONENT') + '...');
        }
        function retryIce(why) {
            if (channelOpen || closed || p2pGaveUp) return;
            if (iceRestarts >= MAX_ICE_RESTARTS) { p2pGaveUp = true; stopPolling(); if (!relayActive) startRelay('DIRECT CONNECTION FAILED'); else onStatus('DIRECT CONNECTION FAILED - STAYING ON SERVER RELAY', 'warn'); return; }
            if (Date.now() - lastIceAttempt < 4000) return; // debounce duplicate failure events
            iceRestarts++; lastIceAttempt = Date.now();
            if (!everOpened) onStatus(why + ' - RETRYING DIRECT (' + iceRestarts + '/' + MAX_ICE_RESTARTS + ')', 'warn');
            if (!relayActive) startRelay(why);
            if (role === 'host') hostOffer(true).catch(() => {});
            if (!polling) poll();
        }
        function scheduleReconnect() { iceRestarts = 0; p2pGaveUp = false; lastIceAttempt = 0; retryIce('RECONNECTING'); }
        async function flushCandidates() { for (const c of pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {}); }
        async function handleSignal(sig) {
            let payload; try { payload = JSON.parse(sig.payload); } catch (e) { return; }
            if (sig.type === 'relay-mode') { if (!channelOpen) startRelay('OPPONENT STARTED SERVER RELAY'); return; }
            if (sig.type === 'bye') { fail('OPPONENT LEFT'); return; }
            if (p2pGaveUp) return;
            if (sig.type === 'offer' && role === 'guest') {
                if (!pc && !setupPeer()) return;
                await pc.setRemoteDescription(payload);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await signal('answer', pc.localDescription);
                await flushCandidates();
                if (!everOpened) onStatus('CONNECTING DIRECTLY...');
            } else if (sig.type === 'answer' && role === 'host' && pc) {
                if (pc.signalingState === 'have-local-offer') { await pc.setRemoteDescription(payload); await flushCandidates(); }
            } else if (sig.type === 'candidate') {
                if (pc && pc.remoteDescription) await pc.addIceCandidate(payload).catch(() => {});
                else pendingCandidates.push(payload);
            }
        }

        // ------------------------------------------------------------------
        // Signalling poll: runs until the direct link is open or P2P is abandoned
        // ------------------------------------------------------------------
        let waitingForGuest = role === 'host' && !opponent;
        let offered = false;
        async function poll() {
            if (closed || channelOpen || p2pGaveUp) { polling = null; return; }
            try {
                if (waitingForGuest) {
                    const st = await get(urls.status);
                    if (st.guest) { waitingForGuest = false; opponent = st.guest; if (opts.onOpponent) opts.onOpponent(opponent); }
                }
                if (!waitingForGuest) {
                    if (role === 'host' && !offered) { offered = true; await hostOffer(false); }
                    const res = await get(urls.signals + '?after=' + lastSignalId);
                    for (const sig of res.signals) { lastSignalId = Math.max(lastSignalId, sig.id); await handleSignal(sig); }
                    // Stuck without any ICE verdict: nudge a restart periodically
                    if (pc && !channelOpen && Date.now() - lastIceAttempt > ICE_RETRY_EVERY) retryIce('DIRECT ATTEMPT TIMED OUT');
                }
            } catch (e) {
                if (!everOpened) onStatus('SIGNALLING ERROR, RETRYING...', 'warn');
            }
            if (!closed && !channelOpen && !p2pGaveUp) polling = setTimeout(poll, waitingForGuest ? 1500 : relayActive ? 1200 : 700);
        }

        // ------------------------------------------------------------------
        // Server relay (fallback; keeps the match going while P2P keeps trying)
        // ------------------------------------------------------------------
        function startRelay(reason, quiet) {
            if (closed || relayActive) return;
            relayActive = true; relayDrainUntil = 0;
            if (!quiet) signal('relay-mode', { reason: reason || '' });
            if (relayTimerStart) { clearTimeout(relayTimerStart); relayTimerStart = null; }
            relayTick();
            if (!channelOpen) announce('relay');
        }
        async function relayTick() {
            if (closed || !relayActive) { relayTimer = null; return; }
            if (channelOpen && relayDrainUntil && Date.now() > relayDrainUntil && outbox.length === 0) { relayActive = false; relayTimer = null; return; }
            if (!relayBusy) {
                relayBusy = true;
                const batch = channelOpen ? [] : outbox.splice(0, 200);
                try {
                    const res = await post(urls.relay, { after: relayLast, msgs: batch });
                    relayFailures = 0;
                    relayLast = Math.max(relayLast, res.last || 0);
                    for (const m of res.msgs) deliver(m);
                } catch (e) {
                    outbox.unshift(...batch);
                    if (!channelOpen && ++relayFailures > 50) { fail('LOST CONTACT WITH SERVER'); return; }
                    if (relayFailures === 5) onStatus('RELAY HICCUP, RETRYING...', 'warn');
                }
                relayBusy = false;
            }
            relayTimer = setTimeout(relayTick, channelOpen ? RELAY_INTERVAL * 3 : RELAY_INTERVAL);
        }

        onStatus(waitingForGuest ? 'WAITING FOR AN OPPONENT' : (role === 'guest' ? 'WAITING FOR HOST...' : 'CONNECTING...'));
        poll();
        window.addEventListener('beforeunload', () => {
            if (closed) return;
            try { navigator.sendBeacon && navigator.sendBeacon(urls.signal, new Blob([JSON.stringify({ type: 'bye', payload: '{}', _token: csrf })], { type: 'application/json' })); } catch (e) { /* ignore */ }
        });

        return {
            send(obj) {
                if (channelOpen && channel && channel.readyState === 'open') { try { channel.send(JSON.stringify(obj)); return true; } catch (e) { /* fall through */ } }
                if (relayActive) { outbox.push(obj); return true; }
                return false;
            },
            close() { closed = true; stopPolling(); if (relayTimer) clearTimeout(relayTimer); try { channel && channel.close(); pc && pc.close(); } catch (e) { /* ignore */ } },
            get open() { return (channelOpen || relayActive) && !closed; },
            get transport() { return transport(); },
            get opponent() { return opponent; }
        };
    }

    root.NQNet = { createLink };
})(window);

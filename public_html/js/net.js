/*
 * NQ Chopper online transport.
 *
 * Pairs two browsers over a WebRTC data channel. The Laravel backend is only
 * used for signalling (offer / answer / ICE candidates) via ordinary HTTP
 * requests and short polling, so it runs on plain shared hosting.
 */
(function (root) {
    'use strict';

    const ICE = { iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }] };

    function createLink(opts) {
        const { code, role, urls, csrf } = opts;
        const onStatus = opts.onStatus || (() => {});
        let pc = null, channel = null, lastSignalId = 0, polling = null, closed = false, opened = false;
        let opponent = opts.opponent || null;

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

        function fail(msg) {
            if (closed) return;
            closed = true;
            stopPolling();
            onStatus(msg, 'error');
            if (opts.onClose) opts.onClose(msg);
        }
        function stopPolling() { if (polling) { clearTimeout(polling); polling = null; } }

        function setupPeer() {
            if (typeof RTCPeerConnection === 'undefined') { fail('THIS BROWSER DOES NOT SUPPORT WEBRTC'); return false; }
            pc = new RTCPeerConnection(ICE);
            pc.onicecandidate = e => { if (e.candidate) signal('candidate', e.candidate.toJSON ? e.candidate.toJSON() : e.candidate); };
            pc.onconnectionstatechange = () => {
                if (pc.connectionState === 'failed') fail('CONNECTION FAILED');
                else if (pc.connectionState === 'disconnected' || pc.connectionState === 'closed') { if (opened) fail('OPPONENT DISCONNECTED'); }
            };
            pc.ondatachannel = e => bindChannel(e.channel);
            return true;
        }
        function bindChannel(ch) {
            channel = ch;
            ch.binaryType = 'arraybuffer';
            ch.onopen = () => { opened = true; stopPolling(); onStatus('CONNECTED', 'ok'); if (opts.onOpen) opts.onOpen(); };
            ch.onclose = () => { if (opened) fail('OPPONENT DISCONNECTED'); };
            ch.onmessage = e => { if (opts.onMessage) { try { opts.onMessage(JSON.parse(e.data)); } catch (err) { /* ignore junk */ } } };
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
        async function handleSignal(sig) {
            let payload; try { payload = JSON.parse(sig.payload); } catch (e) { return; }
            if (sig.type === 'offer' && role === 'guest') {
                if (!pc && !setupPeer()) return;
                await pc.setRemoteDescription(payload);
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                await signal('answer', pc.localDescription);
                for (const c of pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {});
                onStatus('CONNECTING...');
            } else if (sig.type === 'answer' && role === 'host' && pc) {
                await pc.setRemoteDescription(payload);
                for (const c of pendingCandidates.splice(0)) await pc.addIceCandidate(c).catch(() => {});
            } else if (sig.type === 'candidate') {
                if (pc && pc.remoteDescription) await pc.addIceCandidate(payload).catch(() => {});
                else pendingCandidates.push(payload);
            } else if (sig.type === 'bye') {
                fail('OPPONENT LEFT');
            }
        }

        let waitingForGuest = role === 'host' && !opponent;
        let offered = false;
        async function poll() {
            if (closed || opened) return;
            try {
                if (waitingForGuest) {
                    const st = await get(urls.status);
                    if (st.guest) {
                        waitingForGuest = false; opponent = st.guest;
                        if (opts.onOpponent) opts.onOpponent(opponent);
                    }
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

        onStatus(waitingForGuest ? 'WAITING FOR AN OPPONENT' : (role === 'guest' ? 'WAITING FOR HOST...' : 'CONNECTING...'));
        poll();
        // Safety net: give up after two minutes of trying to connect once both are present
        const giveUp = setInterval(() => { if (opened || closed) { clearInterval(giveUp); return; } if (!waitingForGuest && pc && Date.now() - (pc._t || (pc._t = Date.now())) > 120000) fail('COULD NOT CONNECT (NETWORK BLOCKS PEER-TO-PEER)'); }, 5000);
        window.addEventListener('beforeunload', () => { if (!closed) { try { navigator.sendBeacon && navigator.sendBeacon(urls.signal, new Blob([JSON.stringify({ type: 'bye', payload: '{}', _token: csrf })], { type: 'application/json' })); } catch (e) { /* ignore */ } } });

        return {
            send(obj) { if (channel && channel.readyState === 'open') { try { channel.send(JSON.stringify(obj)); return true; } catch (e) { return false; } } return false; },
            close() { closed = true; stopPolling(); try { channel && channel.close(); pc && pc.close(); } catch (e) { /* ignore */ } },
            get open() { return opened && !closed; },
            get opponent() { return opponent; }
        };
    }

    root.NQNet = { createLink };
})(window);

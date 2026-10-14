<?php

namespace App\Http\Controllers;

use App\Models\GameMatch;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class GameController extends Controller
{
    /**
     * Render the NQ Chopper game page, in solo mode or joined to an online match.
     */
    public function __invoke(Request $request, ?string $code = null): View
    {
        $match = null;

        if ($code !== null) {
            abort_unless($request->user(), 403);
            $m = GameMatch::where('code', strtoupper($code))->firstOrFail();
            abort_unless($m->isParticipant($request->user()), 403);
            $opponent = $m->opponentOf($request->user());
            $match = [
                'code' => $m->code,
                'role' => $m->roleOf($request->user()),
                'seed' => $m->seed,
                'status' => $m->status,
                'me' => ['id' => $request->user()->id, 'name' => $request->user()->name],
                'opponent' => $opponent ? ['id' => $opponent->id, 'name' => $opponent->name] : null,
                'urls' => [
                    'status' => route('matches.status', $m),
                    'signal' => route('matches.signal', $m),
                    'signals' => route('matches.signals', $m),
                    'relay' => route('matches.relay', $m),
                    'result' => route('matches.result', $m),
                    'lobby' => route('multiplayer'),
                ],
                'ice' => $this->iceServers(),
            ];
        }

        return view('game', ['match' => $match]);
    }

    /**
     * ICE servers for WebRTC: public STUN plus a free community TURN relay, and
     * the operator's own TURN server when configured in services.turn.
     *
     * @return array<int, array<string, mixed>>
     */
    private function iceServers(): array
    {
        $servers = [
            ['urls' => ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']],
            ['urls' => ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp', 'turns:openrelay.metered.ca:443?transport=tcp'],
                'username' => 'openrelayproject', 'credential' => 'openrelayproject'],
        ];

        $turn = config('services.turn');
        if (! empty($turn['urls'])) {
            $servers[] = array_filter([
                'urls' => array_values(array_filter(array_map('trim', explode(',', $turn['urls'])))),
                'username' => $turn['username'] ?? null,
                'credential' => $turn['credential'] ?? null,
            ], fn ($v) => $v !== null && $v !== '');
        }

        return $servers;
    }
}

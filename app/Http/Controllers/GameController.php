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
                    'result' => route('matches.result', $m),
                    'lobby' => route('multiplayer'),
                ],
            ];
        }

        return view('game', ['match' => $match]);
    }
}

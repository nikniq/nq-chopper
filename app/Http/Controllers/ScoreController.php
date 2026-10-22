<?php

namespace App\Http\Controllers;

use App\Models\Score;
use Illuminate\Http\JsonResponse;
use App\Models\User;
use Illuminate\Http\Request;

class ScoreController extends Controller
{
    /** Top pilots for the in-game panel (cached board; marks the viewer's own row). */
    public function board(Request $request): JsonResponse
    {
        $mode = $request->query('mode') === 'daily' ? 'daily' : 'solo';
        $me = $request->user()?->id;
        $rows = Score::cachedLeaderboard($mode)->take(5)->map(fn ($r) => [
            'name' => $r['name'], 'score' => $r['score'], 'wave' => $r['wave'], 'me' => $me !== null && $r['user_id'] === $me,
        ])->values();

        return response()->json(['mode' => $mode, 'rows' => $rows])->header('Cache-Control', 'public, max-age=30');
    }

    /**
     * Record a finished game for the signed-in player.
     */
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'score' => ['required', 'integer', 'min:0', 'max:100000000'],
            'wave' => ['required', 'integer', 'min:1', 'max:1000'],
            'rescued' => ['required', 'integer', 'min:0', 'max:100000'],
            'mode' => ['sometimes', 'string', 'in:solo,daily'],
            'day' => ['nullable', 'date_format:Y-m-d'],
        ]);

        $mode = $data['mode'] ?? 'solo';
        // Daily runs are always filed under the server's current challenge day
        $day = $mode === 'daily' ? Score::today() : null;
        $score = $request->user()->scores()->create(['score' => $data['score'], 'wave' => $data['wave'], 'rescued' => $data['rescued'], 'mode' => $mode, 'day' => $day]);

        return response()->json([
            'saved' => true,
            'best' => Score::bestFor($request->user(), $mode, $day),
            'rank' => Score::rankOf($score),
        ]);
    }
}

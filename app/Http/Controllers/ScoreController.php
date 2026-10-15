<?php

namespace App\Http\Controllers;

use App\Models\Score;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class ScoreController extends Controller
{
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

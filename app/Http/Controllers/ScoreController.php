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
        ]);

        $score = $request->user()->scores()->create($data);

        return response()->json([
            'saved' => true,
            'best' => Score::bestFor($request->user()),
            'rank' => Score::rankOf($score),
        ]);
    }
}

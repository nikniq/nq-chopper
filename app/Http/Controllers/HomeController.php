<?php

namespace App\Http\Controllers;

use App\Models\Score;
use App\Models\User;
use Illuminate\Contracts\View\View;
use Illuminate\Support\Facades\Cache;

class HomeController extends Controller
{
    /**
     * Render the front page: pitch, game modes, live boards and the field manual.
     */
    public function __invoke(): View
    {
        $totals = Cache::remember('home.totals', 600, function () {
            $t = Score::query()->toBase()->selectRaw('COUNT(*) as runs, COALESCE(SUM(rescued), 0) as rescued, COALESCE(MAX(wave), 0) as top_wave')->first();

            return ['pilots' => User::count(), 'runs' => (int) $t->runs, 'rescued' => (int) $t->rescued, 'topWave' => (int) $t->top_wave];
        });

        return view('home', [
            'leaders' => Score::cachedLeaderboard('solo'),
            'dailyLeaders' => Score::cachedLeaderboard('daily'),
            'today' => Score::today(),
            'totals' => $totals,
            'personalBest' => auth()->check() ? Score::bestFor(auth()->user()) : null,
            'dailyBest' => auth()->check() ? Score::bestFor(auth()->user(), 'daily') : null,
        ]);
    }
}

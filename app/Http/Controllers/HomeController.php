<?php

namespace App\Http\Controllers;

use App\Models\Score;
use Illuminate\Contracts\View\View;

class HomeController extends Controller
{
    /**
     * Render the front page with the leaderboard.
     */
    public function __invoke(): View
    {
        return view('home', [
            'leaders' => Score::leaderboard(10),
            'personalBest' => auth()->check() ? Score::bestFor(auth()->user()) : null,
        ]);
    }
}

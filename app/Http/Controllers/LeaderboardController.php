<?php

namespace App\Http\Controllers;

use App\Models\Score;
use Carbon\Carbon;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

class LeaderboardController extends Controller
{
    public const BOARDS = ['alltime' => 'All-time', 'monthly' => 'This month', 'weekly' => 'This week', 'daily' => 'Daily Challenge'];

    public function __invoke(Request $request): View
    {
        $board = $request->query('board', 'alltime');
        abort_unless(array_key_exists($board, self::BOARDS), 404);

        $day = null;
        if ($board === 'daily') {
            try {
                $day = Carbon::parse($request->query('day', Score::today()))->toDateString();
            } catch (\Throwable) {
                abort(404);
            }
            abort_if($day > Score::today(), 404);
        }

        $rows = Score::periodBoard($board, $day, 50);
        $me = $request->user();

        return view('leaderboard', [
            'boards' => self::BOARDS,
            'board' => $board,
            'day' => $day,
            'rows' => $rows,
            'myRank' => $me ? Score::periodRank($board, $day, $me) : null,
            'prevDay' => $day ? Carbon::parse($day)->subDay()->toDateString() : null,
            'nextDay' => $day && $day < Score::today() ? Carbon::parse($day)->addDay()->toDateString() : null,
        ]);
    }
}

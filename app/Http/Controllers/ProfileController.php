<?php

namespace App\Http\Controllers;

use App\Models\GameMatch;
use App\Models\Score;
use App\Models\User;
use App\Support\Achievements;
use Illuminate\Contracts\View\View;

class ProfileController extends Controller
{
    /**
     * Public pilot profile: records, recent runs and match history.
     */
    public function __invoke(User $user): View
    {
        $solo = Score::board('solo')->where('user_id', $user->id);
        $matches = GameMatch::with(['host', 'guest', 'winner'])
            ->where('status', 'finished')->where('mode', 'versus')
            ->where(fn ($q) => $q->where('host_user_id', $user->id)->orWhere('guest_user_id', $user->id))
            ->latest('finished_at')->limit(10)->get();
        $duels = GameMatch::where('status', 'finished')->where('mode', 'versus')
            ->where(fn ($q) => $q->where('host_user_id', $user->id)->orWhere('guest_user_id', $user->id));
        $played = (clone $duels)->count();
        $games = (clone $solo)->count();
        // Oldest first, so the chart reads left to right
        $trend = (clone $solo)->latest()->latest('id')->limit(20)->pluck('score')->reverse()->values();

        return view('profile', [
            'pilot' => $user,
            'stats' => [
                'best' => (int) (clone $solo)->max('score'),
                'games' => $games,
                'average' => $games ? (int) round((clone $solo)->avg('score')) : 0,
                'rank' => $games ? Score::periodRank('alltime', null, $user)['rank'] : null,
                'dailies' => Score::where('user_id', $user->id)->where('mode', 'daily')->distinct()->count('day'),
                'rescued' => (int) Score::where('user_id', $user->id)->sum('rescued'),
                'topWave' => (int) (clone $solo)->max('wave'),
                'dailyBest' => Score::bestFor($user, 'daily'),
                'matches' => $played,
                'wins' => (clone $duels)->where('winner_user_id', $user->id)->count(),
            ],
            'trend' => $trend,
            'recent' => Score::where('user_id', $user->id)->latest()->limit(10)->get(),
            'badges' => Achievements::for($user),
            'matches' => $matches,
        ]);
    }
}

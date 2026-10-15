<?php

namespace App\Http\Controllers;

use App\Models\GameMatch;
use App\Models\Score;
use App\Models\User;
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
            ->where('status', 'finished')
            ->where(fn ($q) => $q->where('host_user_id', $user->id)->orWhere('guest_user_id', $user->id))
            ->latest('finished_at')->limit(10)->get();
        $played = GameMatch::where('status', 'finished')
            ->where(fn ($q) => $q->where('host_user_id', $user->id)->orWhere('guest_user_id', $user->id))->count();

        return view('profile', [
            'pilot' => $user,
            'stats' => [
                'best' => (int) (clone $solo)->max('score'),
                'games' => (clone $solo)->count(),
                'rescued' => (int) (clone $solo)->sum('rescued'),
                'topWave' => (int) (clone $solo)->max('wave'),
                'dailyBest' => Score::bestFor($user, 'daily'),
                'matches' => $played,
                'wins' => GameMatch::where('status', 'finished')->where('winner_user_id', $user->id)->count(),
            ],
            'recent' => Score::where('user_id', $user->id)->latest()->limit(10)->get(),
            'matches' => $matches,
        ]);
    }
}

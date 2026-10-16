<?php

namespace App\Support;

use App\Models\GameMatch;
use App\Models\Score;
use App\Models\User;

/**
 * Badges derived from a pilot's recorded runs and duels. Nothing is stored:
 * every badge is a predicate over the stats, so new badges apply retroactively.
 */
class Achievements
{
    /** @return array<int, array{key: string, name: string, desc: string, icon: string, earned: bool}> */
    public static function for(User $user): array
    {
        $solo = Score::where('user_id', $user->id);
        $s = [
            'runs' => (clone $solo)->count(),
            'rescued' => (int) (clone $solo)->sum('rescued'),
            'wave' => (int) (clone $solo)->max('wave'),
            'best' => (int) (clone $solo)->max('score'),
            'dailies' => (clone $solo)->where('mode', 'daily')->distinct('day')->count('day'),
            'duels' => GameMatch::where('status', 'finished')->where(fn ($q) => $q->where('host_user_id', $user->id)->orWhere('guest_user_id', $user->id))->count(),
            'wins' => GameMatch::where('status', 'finished')->where('winner_user_id', $user->id)->count(),
        ];

        $defs = [
            ['first-flight', 'First Flight', 'Finish a run', '🚁', $s['runs'] >= 1],
            ['rescuer', 'Rescuer', 'Rescue 25 hostages in total', '🙌', $s['rescued'] >= 25],
            ['saviour', 'Saviour', 'Rescue 100 hostages in total', '🏅', $s['rescued'] >= 100],
            ['wave-3', 'Gunship Hunter', 'Reach wave 3', '🎯', $s['wave'] >= 3],
            ['wave-5', 'Veteran', 'Reach wave 5', '⭐', $s['wave'] >= 5],
            ['wave-10', 'Legend', 'Reach wave 10', '👑', $s['wave'] >= 10],
            ['score-5k', 'High Scorer', 'Score 5,000 in one run', '💯', $s['best'] >= 5000],
            ['score-20k', 'Ace', 'Score 20,000 in one run', '🔥', $s['best'] >= 20000],
            ['daily', 'Daily Pilot', 'Fly a Daily Challenge', '📅', $s['dailies'] >= 1],
            ['daily-7', 'Regular', 'Fly seven different Daily Challenges', '🗓️', $s['dailies'] >= 7],
            ['duelist', 'Duelist', 'Finish an online match', '⚔️', $s['duels'] >= 1],
            ['champion', 'Champion', 'Win five online matches', '🏆', $s['wins'] >= 5],
        ];

        return array_map(fn ($d) => ['key' => $d[0], 'name' => $d[1], 'desc' => $d[2], 'icon' => $d[3], 'earned' => $d[4]], $defs);
    }
}

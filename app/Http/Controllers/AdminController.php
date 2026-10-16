<?php

namespace App\Http\Controllers;

use App\Models\GameMatch;
use App\Models\Score;
use App\Models\User;
use Illuminate\Contracts\View\View;
use Illuminate\Http\Request;

/**
 * Operator dashboard. Access is limited to the emails listed in ADMIN_EMAILS.
 */
class AdminController extends Controller
{
    public function __invoke(Request $request): View
    {
        abort_unless(self::isAdmin($request->user()), 403);

        return view('admin', [
            'users' => ['total' => User::count(), 'week' => User::where('created_at', '>=', now()->subWeek())->count()],
            'runs' => ['total' => Score::count(), 'today' => Score::where('created_at', '>=', now()->startOfDay())->count(), 'daily' => Score::board('daily')->distinct('user_id')->count('user_id')],
            'matches' => ['waiting' => GameMatch::where('status', 'waiting')->count(), 'active' => GameMatch::where('status', 'active')->count(), 'finished' => GameMatch::where('status', 'finished')->count()],
            'newest' => User::latest()->limit(10)->get(),
            'recentRuns' => Score::with('user')->latest()->limit(10)->get(),
        ]);
    }

    public static function isAdmin(?User $user): bool
    {
        if (! $user) {
            return false;
        }
        $admins = array_filter(array_map('trim', explode(',', (string) config('app.admins'))));

        return in_array(strtolower($user->email), array_map('strtolower', $admins), true);
    }
}

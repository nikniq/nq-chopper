<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

#[Fillable(['score', 'wave', 'rescued'])]
class Score extends Model
{
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Best score per player, highest first.
     *
     * @return Collection<int, Score>
     */
    public static function leaderboard(int $limit = 10): Collection
    {
        $best = static::query()
            ->select('user_id', DB::raw('MAX(score) as best'))
            ->groupBy('user_id');

        return static::query()
            ->joinSub($best, 'best', fn ($join) => $join->on('scores.user_id', '=', 'best.user_id')->on('scores.score', '=', 'best.best'))
            ->with('user')
            ->select('scores.*')
            ->orderByDesc('scores.score')
            ->orderBy('scores.created_at')
            ->get()
            ->unique('user_id')
            ->take($limit)
            ->values();
    }

    public static function bestFor(User $user): int
    {
        return (int) static::query()->where('user_id', $user->id)->max('score');
    }

    /**
     * 1-based position of this score among every player's best score.
     */
    public static function rankOf(Score $score): int
    {
        $better = static::query()
            ->select('user_id')
            ->where('user_id', '!=', $score->user_id)
            ->groupBy('user_id')
            ->havingRaw('MAX(score) > ?', [$score->score])
            ->get()
            ->count();

        return $better + 1;
    }
}

<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;

#[Fillable(['score', 'wave', 'rescued', 'mode', 'day'])]
class Score extends Model
{
    protected function casts(): array
    {
        return ['day' => 'date'];
    }

    /** Today's Daily Challenge date (UTC) and the seed everyone shares for it. */
    public static function today(): string
    {
        return now('UTC')->toDateString();
    }

    public static function dailySeed(?string $day = null): int
    {
        return (int) (crc32('nq-daily-'.($day ?? static::today())) & 0x7fffffff);
    }

    /** Query scoped to one board: the all-time solo board or one day's challenge. */
    public static function board(string $mode = 'solo', ?string $day = null)
    {
        $q = static::query()->where('mode', $mode);

        return $mode === 'daily' ? $q->whereDate('day', $day ?? static::today()) : $q;
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Best score per player, highest first.
     *
     * @return Collection<int, Score>
     */
    public static function leaderboard(int $limit = 10, string $mode = 'solo', ?string $day = null): Collection
    {
        $best = static::board($mode, $day)
            ->select('user_id', DB::raw('MAX(score) as best'))
            ->groupBy('user_id');

        return static::board($mode, $day)
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

    public static function bestFor(User $user, string $mode = 'solo', ?string $day = null): int
    {
        return (int) static::board($mode, $day)->where('user_id', $user->id)->max('score');
    }

    /**
     * 1-based position of this score among every player's best score.
     */
    public static function rankOf(Score $score): int
    {
        $better = static::board($score->mode, $score->day?->toDateString())
            ->select('user_id')
            ->where('user_id', '!=', $score->user_id)
            ->groupBy('user_id')
            ->havingRaw('MAX(score) > ?', [$score->score])
            ->get()
            ->count();

        return $better + 1;
    }
}

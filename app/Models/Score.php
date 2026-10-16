<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Cache;
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

    /**
     * Period boards for the leaderboard page: alltime | monthly | weekly | daily.
     * Monthly and weekly are solo runs recorded since the start of the period.
     */
    public static function periodQuery(string $board, ?string $day = null)
    {
        return match ($board) {
            'daily' => static::board('daily', $day),
            'monthly' => static::board('solo')->where('created_at', '>=', now()->startOfMonth()),
            'weekly' => static::board('solo')->where('created_at', '>=', now()->startOfWeek()),
            default => static::board('solo'),
        };
    }

    /** @return Collection<int, Score> best run per pilot, highest first */
    public static function periodBoard(string $board, ?string $day = null, int $limit = 50): Collection
    {
        $best = static::periodQuery($board, $day)->select('user_id', DB::raw('MAX(score) as best'))->groupBy('user_id');

        return static::periodQuery($board, $day)
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

    /** @return array{rank: int, score: int}|null the pilot's position on a period board */
    public static function periodRank(string $board, ?string $day, User $user): ?array
    {
        $mine = (int) static::periodQuery($board, $day)->where('user_id', $user->id)->max('score');
        if ($mine === 0 && ! static::periodQuery($board, $day)->where('user_id', $user->id)->exists()) {
            return null;
        }
        $better = static::periodQuery($board, $day)->select('user_id')->where('user_id', '!=', $user->id)
            ->groupBy('user_id')->havingRaw('MAX(score) > ?', [$mine])->get()->count();

        return ['rank' => $better + 1, 'score' => $mine];
    }

    /** Query scoped to one board: the all-time solo board or one day's challenge. */
    public static function board(string $mode = 'solo', ?string $day = null)
    {
        $q = static::query()->where('mode', $mode);

        return $mode === 'daily' ? $q->whereDate('day', $day ?? static::today()) : $q;
    }

    protected static function booted(): void
    {
        static::saved(fn () => static::forgetBoards());
        static::deleted(fn () => static::forgetBoards());
    }

    public static function forgetBoards(): void
    {
        Cache::forget('lb:solo');
        Cache::forget('lb:daily:'.static::today());
    }

    /** Cached top-10 boards for the front page (invalidated on every new score). */
    public static function cachedLeaderboard(string $mode = 'solo'): Collection
    {
        $key = $mode === 'daily' ? 'lb:daily:'.static::today() : 'lb:solo';

        return Cache::remember($key, 120, fn () => static::leaderboard(10, $mode));
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

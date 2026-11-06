<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Collection;
use Illuminate\Support\Str;

#[Fillable(['code', 'host_user_id', 'guest_user_id', 'seed', 'mode', 'status', 'winner_user_id', 'host_score', 'guest_score', 'wave', 'reason', 'finished_at'])]
class GameMatch extends Model
{
    protected $table = 'matches';

    protected function casts(): array
    {
        return ['finished_at' => 'datetime'];
    }

    public function host(): BelongsTo
    {
        return $this->belongsTo(User::class, 'host_user_id');
    }

    public function guest(): BelongsTo
    {
        return $this->belongsTo(User::class, 'guest_user_id');
    }

    public function winner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'winner_user_id');
    }

    public function signals(): HasMany
    {
        return $this->hasMany(MatchSignal::class, 'match_id');
    }

    public const MODES = ['versus' => 'Versus 1v1', 'coop' => 'Co-op vs AI'];

    public static function createFor(User $host, string $mode = 'versus'): self
    {
        do {
            // Unambiguous characters only; easy to read out loud
            $code = strtoupper(Str::random(6));
            $code = strtr($code, ['0' => 'X', 'O' => 'Y', '1' => 'Z', 'I' => 'W', 'L' => 'V']);
        } while (static::where('code', $code)->exists());

        return static::create([
            'code' => $code,
            'host_user_id' => $host->id,
            'seed' => random_int(1, 2_000_000_000),
            'mode' => array_key_exists($mode, self::MODES) ? $mode : 'versus',
        ]);
    }

    /**
     * Finished versus matches ranked by wins, then win rate. Co-op has no winner to rank.
     *
     * @return Collection<int, array{user: User, wins: int, played: int, rate: int}>
     */
    public static function duelBoard(int $limit = 50): Collection
    {
        $matches = static::where('status', 'finished')->where('mode', 'versus')
            ->whereNotNull('guest_user_id')->get(['host_user_id', 'guest_user_id', 'winner_user_id']);
        $tally = [];
        foreach ($matches as $m) {
            foreach ([$m->host_user_id, $m->guest_user_id] as $id) {
                $tally[$id] ??= ['wins' => 0, 'played' => 0];
                $tally[$id]['played']++;
                $tally[$id]['wins'] += $m->winner_user_id === $id ? 1 : 0;
            }
        }
        $users = User::whereIn('id', array_keys($tally))->get()->keyBy('id');

        return collect($tally)
            ->filter(fn ($t, $id) => $users->has($id))
            ->map(fn ($t, $id) => $t + ['user' => $users[$id], 'rate' => (int) round(100 * $t['wins'] / $t['played'])])
            ->sortBy([['wins', 'desc'], ['rate', 'desc'], ['played', 'asc']])
            ->take($limit)->values();
    }

    public function isParticipant(User $user): bool
    {
        return $user->id === $this->host_user_id || $user->id === $this->guest_user_id;
    }

    public function roleOf(User $user): ?string
    {
        return match ($user->id) {
            $this->host_user_id => 'host',
            $this->guest_user_id => 'guest',
            default => null,
        };
    }

    public function opponentOf(User $user): ?User
    {
        return $user->id === $this->host_user_id ? $this->guest : $this->host;
    }
}

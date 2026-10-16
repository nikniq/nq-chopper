<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
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

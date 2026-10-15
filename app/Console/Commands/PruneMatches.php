<?php

namespace App\Console\Commands;

use App\Models\GameMatch;
use App\Models\MatchSignal;
use Illuminate\Console\Command;

class PruneMatches extends Command
{
    protected $signature = 'matches:prune';

    protected $description = 'Remove abandoned lobbies, stale active matches and leftover signalling rows';

    public function handle(): int
    {
        $lobbies = GameMatch::where('status', 'waiting')->where('created_at', '<', now()->subDay())->delete();
        $stale = GameMatch::where('status', 'active')->where('updated_at', '<', now()->subHours(6))->delete();
        $signals = MatchSignal::where('created_at', '<', now()->subHours(2))->delete();

        $this->info("Pruned {$lobbies} lobbies, {$stale} stale matches, {$signals} signals.");

        return self::SUCCESS;
    }
}

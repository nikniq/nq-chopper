<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\File;

class BackupDatabase extends Command
{
    protected $signature = 'db:backup {--keep=14 : How many backups to retain}';

    protected $description = 'Snapshot the SQLite database into storage/app/backups and prune old copies';

    public function handle(): int
    {
        $connection = config('database.default');
        if (config("database.connections.{$connection}.driver") !== 'sqlite') {
            $this->warn("db:backup only handles SQLite; connection '{$connection}' skipped. Use your database's own dump tool.");

            return self::SUCCESS;
        }

        $dir = storage_path('app/backups');
        File::ensureDirectoryExists($dir);
        $target = $dir.'/db-'.now()->format('Ymd-His').'.sqlite';

        // VACUUM INTO produces a consistent copy even while the app is writing
        DB::statement('VACUUM INTO '.DB::getPdo()->quote($target));

        $backups = collect(File::files($dir))
            ->filter(fn ($f) => str_starts_with($f->getFilename(), 'db-') && $f->getExtension() === 'sqlite')
            ->sortByDesc(fn ($f) => $f->getFilename())
            ->values();
        $removed = 0;
        foreach ($backups->slice(max(1, (int) $this->option('keep'))) as $old) {
            File::delete($old->getPathname());
            $removed++;
        }

        $this->info(sprintf('Backup written to %s (%s). Kept %d, removed %d.', $target, $this->human(filesize($target)), min($backups->count(), (int) $this->option('keep')), $removed));

        return self::SUCCESS;
    }

    private function human(int $bytes): string
    {
        return $bytes >= 1048576 ? round($bytes / 1048576, 1).' MB' : round($bytes / 1024).' KB';
    }
}

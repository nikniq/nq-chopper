<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;
use Tests\TestCase;

class OpsTest extends TestCase
{
    use RefreshDatabase;

    public function test_health_endpoint_reports_ok(): void
    {
        $this->getJson('/health')->assertOk()
            ->assertJsonPath('status', 'ok')
            ->assertJsonPath('checks.database', true)
            ->assertJsonPath('checks.cache', true)
            ->assertJsonPath('checks.storage', true);
    }

    public function test_backup_command_writes_and_rotates_sqlite_snapshots(): void
    {
        if (config('database.connections.'.config('database.default').'.driver') !== 'sqlite') {
            $this->markTestSkipped('SQLite only');
        }
        if (config('database.connections.'.config('database.default').'.database') === ':memory:') {
            $this->markTestSkipped('VACUUM INTO needs an on-disk database');
        }
        $dir = storage_path('app/backups');
        File::ensureDirectoryExists($dir);
        foreach (['db-20200101-000000.sqlite', 'db-20200102-000000.sqlite'] as $f) {
            File::put($dir.'/'.$f, '');
        }

        Artisan::call('db:backup', ['--keep' => 2]);
        $files = collect(File::files($dir))->map->getFilename()->filter(fn ($f) => str_starts_with($f, 'db-'))->sort()->values();

        $this->assertCount(2, $files, 'rotation keeps only the newest two');
        $this->assertStringContainsString('db-20200102', $files[0]);
        $this->assertGreaterThan(0, filesize($dir.'/'.$files[1]), 'fresh snapshot has content');
        File::delete($dir.'/'.$files[1]);
        File::delete($dir.'/'.$files[0]);
    }
}

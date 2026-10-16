<?php

namespace App\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Health check for uptime monitors: 200 when the database, cache and storage
 * are usable, 503 otherwise. Never exposes secrets.
 */
class HealthController extends Controller
{
    public function __invoke(): JsonResponse
    {
        $checks = [
            'database' => $this->try(fn () => DB::select('select 1')),
            'cache' => $this->try(function () {
                Cache::put('health:ping', 1, 10);

                return Cache::get('health:ping') === 1;
            }),
            'storage' => $this->try(fn () => is_writable(storage_path('logs')) && is_writable(storage_path('framework'))),
        ];
        $ok = ! in_array(false, $checks, true);

        return response()->json([
            'status' => $ok ? 'ok' : 'degraded',
            'checks' => $checks,
            'app' => config('app.name'),
            'time' => now()->toIso8601String(),
        ], $ok ? 200 : 503);
    }

    private function try(callable $check): bool
    {
        try {
            return (bool) $check();
        } catch (\Throwable) {
            return false;
        }
    }
}

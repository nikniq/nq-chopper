<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('scores', function (Blueprint $table) {
            $table->string('mode', 12)->default('solo')->after('rescued'); // solo | daily
            $table->date('day')->nullable()->after('mode');                 // daily challenge date
            $table->index(['mode', 'day', 'score']);
        });
    }

    public function down(): void
    {
        Schema::table('scores', function (Blueprint $table) {
            $table->dropIndex(['mode', 'day', 'score']);
            $table->dropColumn(['mode', 'day']);
        });
    }
};

<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('matches', function (Blueprint $table) {
            $table->string('mode', 12)->default('versus')->after('seed'); // versus | coop
            $table->unsignedSmallInteger('wave')->nullable()->after('guest_score'); // co-op: wave reached
        });
    }

    public function down(): void
    {
        Schema::table('matches', function (Blueprint $table) {
            $table->dropColumn(['mode', 'wave']);
        });
    }
};

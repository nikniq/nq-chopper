<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('matches:prune')->hourly();
Schedule::command('db:backup')->dailyAt('03:15');

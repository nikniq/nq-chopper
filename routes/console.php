<?php

use Illuminate\Support\Facades\Schedule;

Schedule::command('matches:prune')->hourly();

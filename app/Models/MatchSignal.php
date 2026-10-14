<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Model;

#[Fillable(['match_id', 'user_id', 'type', 'payload'])]
class MatchSignal extends Model
{
}

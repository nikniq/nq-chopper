<?php

namespace App\Http\Controllers;

use Illuminate\Contracts\View\View;

class GameController extends Controller
{
    /**
     * Render the NQ Chopper game page.
     */
    public function __invoke(): View
    {
        return view('game');
    }
}

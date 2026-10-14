<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\GameController;
use App\Http\Controllers\HomeController;
use App\Http\Controllers\MatchController;
use App\Http\Controllers\ScoreController;
use Illuminate\Support\Facades\Route;

Route::get('/', HomeController::class)->name('home');
Route::get('/play/{code?}', GameController::class)->name('game');

Route::middleware('guest')->group(function () {
    Route::get('/register', [RegisterController::class, 'create'])->name('register');
    Route::post('/register', [RegisterController::class, 'store']);
    Route::get('/login', [LoginController::class, 'create'])->name('login');
    Route::post('/login', [LoginController::class, 'store']);
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [LoginController::class, 'destroy'])->name('logout');
    Route::post('/scores', [ScoreController::class, 'store'])->name('scores.store');

    Route::get('/multiplayer', [MatchController::class, 'index'])->name('multiplayer');
    Route::post('/matches', [MatchController::class, 'store'])->name('matches.store');
    Route::post('/matches/join', [MatchController::class, 'join'])->name('matches.join');
    Route::get('/matches/{match:code}/status', [MatchController::class, 'status'])->name('matches.status');
    Route::post('/matches/{match:code}/signal', [MatchController::class, 'signal'])->name('matches.signal');
    Route::get('/matches/{match:code}/signals', [MatchController::class, 'signals'])->name('matches.signals');
    Route::post('/matches/{match:code}/result', [MatchController::class, 'result'])->name('matches.result');
});

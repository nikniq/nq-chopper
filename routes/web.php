<?php

use App\Http\Controllers\Auth\LoginController;
use App\Http\Controllers\Auth\RegisterController;
use App\Http\Controllers\GameController;
use App\Http\Controllers\HomeController;
use App\Http\Controllers\MatchController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ScoreController;
use App\Http\Controllers\SettingsController;
use Illuminate\Support\Facades\Route;

Route::get('/', HomeController::class)->name('home');
Route::get('/play/{code?}', GameController::class)->name('game');
Route::get('/pilots/{user}', ProfileController::class)->name('profile');

Route::middleware('guest')->group(function () {
    Route::get('/register', [RegisterController::class, 'create'])->name('register');
    Route::post('/register', [RegisterController::class, 'store'])->middleware('throttle:10,1');
    Route::get('/login', [LoginController::class, 'create'])->name('login');
    Route::post('/login', [LoginController::class, 'store'])->middleware('throttle:20,1');
});

Route::middleware('auth')->group(function () {
    Route::post('/logout', [LoginController::class, 'destroy'])->name('logout');
    Route::post('/scores', [ScoreController::class, 'store'])->middleware('throttle:30,1')->name('scores.store');

    Route::get('/settings', [SettingsController::class, 'edit'])->name('settings');
    Route::post('/settings/name', [SettingsController::class, 'updateName'])->name('settings.name');
    Route::post('/settings/password', [SettingsController::class, 'updatePassword'])->name('settings.password');
    Route::post('/settings/delete', [SettingsController::class, 'destroy'])->name('settings.delete');

    Route::get('/multiplayer', [MatchController::class, 'index'])->name('multiplayer');
    Route::post('/matches', [MatchController::class, 'store'])->middleware('throttle:10,1')->name('matches.store');
    Route::post('/matches/join', [MatchController::class, 'join'])->middleware('throttle:20,1')->name('matches.join');
    Route::get('/matches/{match:code}/status', [MatchController::class, 'status'])->name('matches.status');
    Route::post('/matches/{match:code}/signal', [MatchController::class, 'signal'])->middleware('throttle:120,1')->name('matches.signal');
    Route::get('/matches/{match:code}/signals', [MatchController::class, 'signals'])->name('matches.signals');
    Route::post('/matches/{match:code}/relay', [MatchController::class, 'relay'])->name('matches.relay');
    Route::post('/matches/{match:code}/result', [MatchController::class, 'result'])->middleware('throttle:10,1')->name('matches.result');
});

@extends('layouts.app')
@section('title', 'Register · NQ Chopper')

@section('content')
<section class="card">
    <h1>Register</h1>
    <p class="muted">Pick a pilot name for the leaderboard.</p>
    @if (\App\Http\Controllers\Auth\GoogleController::enabled())
        <a href="{{ route('auth.google') }}" class="btn btn-google">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.3l7.8 6C12.3 13.5 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4 7.1-10 7.1-17.5z"/><path fill="#FBBC05" d="M10.4 28.7A14.5 14.5 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.9 2.3-8.4 2.3-6.3 0-11.7-4-13.6-9.7l-7.8 6C6.5 42.6 14.6 48 24 48z"/></svg>
            Continue with Google
        </a>
        <p class="muted or">or</p>
    @endif
    <form method="POST" action="{{ route('register') }}">
        @csrf
        <label>Pilot name
            <input type="text" name="name" value="{{ old('name') }}" required autofocus maxlength="30" autocomplete="nickname">
        </label>
        @error('name')<p class="error">{{ $message }}</p>@enderror
        <label>Email
            <input type="email" name="email" value="{{ old('email') }}" required autocomplete="email">
        </label>
        @error('email')<p class="error">{{ $message }}</p>@enderror
        <label>Password <span class="muted">(8+ characters)</span>
            <input type="password" name="password" required autocomplete="new-password">
        </label>
        @error('password')<p class="error">{{ $message }}</p>@enderror
        <label>Confirm password
            <input type="password" name="password_confirmation" required autocomplete="new-password">
        </label>
        <button type="submit" class="btn btn-big">Create account</button>
    </form>
    <p class="muted">Already registered? <a href="{{ route('login') }}">Log in</a></p>
</section>
@endsection

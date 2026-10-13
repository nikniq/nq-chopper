@extends('layouts.app')
@section('title', 'Register · NQ Chopper')

@section('content')
<section class="card">
    <h1>Register</h1>
    <p class="muted">Pick a pilot name for the leaderboard.</p>
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

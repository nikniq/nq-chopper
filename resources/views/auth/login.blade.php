@extends('layouts.app')
@section('title', 'Log in · NQ Chopper')

@section('content')
<section class="card">
    <h1>Log in</h1>
    <form method="POST" action="{{ route('login') }}">
        @csrf
        <label>Email
            <input type="email" name="email" value="{{ old('email') }}" required autofocus autocomplete="email">
        </label>
        @error('email')<p class="error">{{ $message }}</p>@enderror
        <label>Password
            <input type="password" name="password" required autocomplete="current-password">
        </label>
        @error('password')<p class="error">{{ $message }}</p>@enderror
        <label class="check"><input type="checkbox" name="remember" value="1" {{ old('remember') ? 'checked' : '' }}> Remember me</label>
        <button type="submit" class="btn btn-big">Log in</button>
    </form>
    <p class="muted">New pilot? <a href="{{ route('register') }}">Register</a></p>
</section>
@endsection

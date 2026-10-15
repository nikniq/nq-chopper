@extends('layouts.app')
@section('title', 'Reset password · NQ Chopper')

@section('content')
<section class="card">
    <h1>Choose a new password</h1>
    <form method="POST" action="{{ route('password.update') }}">
        @csrf
        <input type="hidden" name="token" value="{{ $token }}">
        <label>Email <input type="email" name="email" value="{{ old('email', $email) }}" required autocomplete="email"></label>
        @error('email')<p class="error">{{ $message }}</p>@enderror
        <label>New password <span class="muted">(8+ characters)</span> <input type="password" name="password" required autocomplete="new-password"></label>
        @error('password')<p class="error">{{ $message }}</p>@enderror
        <label>Confirm new password <input type="password" name="password_confirmation" required autocomplete="new-password"></label>
        <button type="submit" class="btn btn-big">Reset password</button>
    </form>
</section>
@endsection

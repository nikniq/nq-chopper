@extends('layouts.app')
@section('title', 'Forgot password · NQ Chopper')

@section('content')
<section class="card">
    <h1>Forgot password</h1>
    <p class="muted">Enter your email and we will send a link to choose a new password.</p>
    @if (session('status'))<p class="flash">{{ session('status') }}</p>@endif
    <form method="POST" action="{{ route('password.email') }}">
        @csrf
        <label>Email <input type="email" name="email" value="{{ old('email') }}" required autofocus autocomplete="email"></label>
        @error('email')<p class="error">{{ $message }}</p>@enderror
        <button type="submit" class="btn btn-big">Send reset link</button>
    </form>
    <p class="muted"><a href="{{ route('login') }}">Back to log in</a></p>
</section>
@endsection

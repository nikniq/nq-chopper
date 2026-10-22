@extends('layouts.app')
@section('title', 'Settings · NQ Chopper')

@section('content')
<section class="hero compact"><h1>Account settings</h1></section>
@if (session('status'))<p class="flash">{{ session('status') }}</p>@endif

<div class="two-col">
    <section class="card">
        <h2>Pilot name</h2>
        <form method="POST" action="{{ route('settings.name') }}">
            @csrf
            <label>Name <input type="text" name="name" value="{{ old('name', auth()->user()->name) }}" required maxlength="30"></label>
            @error('name')<p class="error">{{ $message }}</p>@enderror
            <button type="submit" class="btn">Save name</button>
        </form>
    </section>

    <section class="card">
        <h2>Change password</h2>
        <form method="POST" action="{{ route('settings.password') }}">
            @csrf
            <label>Current password <input type="password" name="current_password" required autocomplete="current-password"></label>
            @error('current_password')<p class="error">{{ $message }}</p>@enderror
            <label>New password <input type="password" name="password" required autocomplete="new-password"></label>
            @error('password')<p class="error">{{ $message }}</p>@enderror
            <label>Confirm new password <input type="password" name="password_confirmation" required autocomplete="new-password"></label>
            <button type="submit" class="btn">Change password</button>
        </form>
    </section>
</div>

@if (auth()->user()->google_id)
<section class="card" style="max-width:none">
    <h2>Google</h2>
    <p class="muted">This account is linked to Google{{ auth()->user()->email ? ' ('.auth()->user()->email.')' : '' }}. You can sign in with Google or with your password. If you never set a password, use "Forgot password" to create one.</p>
</section>
@endif

<section class="card danger">
    <h2>Delete account</h2>
    <p class="muted">Removes your account, scores and match history permanently.</p>
    <form method="POST" action="{{ route('settings.delete') }}" onsubmit="return confirm('Delete your account and all scores? This cannot be undone.')">
        @csrf
        <label>Current password <input type="password" name="current_password" required autocomplete="current-password"></label>
        <button type="submit" class="btn btn-danger">Delete my account</button>
    </form>
</section>
@endsection

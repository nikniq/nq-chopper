@extends('layouts.app')
@section('title', '403 · NQ Chopper')

@section('content')
<section class="hero">
    <h1 class="err-code">403</h1>
    <p class="tagline">Access denied</p>
    <p class="blurb">You are not part of that match, or you need to log in first.</p>
    <div class="cta"><a href="{{ route('home') }}" class="btn btn-big">Home</a> <a href="{{ route('game') }}" class="btn btn-big btn-ghost">Play</a></div>
</section>
@endsection

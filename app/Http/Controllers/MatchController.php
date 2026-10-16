<?php

namespace App\Http\Controllers;

use App\Models\GameMatch;
use Illuminate\Contracts\View\View;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * Lobby, matchmaking and WebRTC signalling for online 1v1 matches.
 *
 * The server never sees gameplay: both browsers run the same deterministic
 * simulation in lockstep and exchange inputs peer-to-peer. These endpoints
 * only pair players, relay the WebRTC handshake, and record the result.
 */
class MatchController extends Controller
{
    public function index(Request $request): View
    {
        $user = $request->user();

        return view('multiplayer', [
            'open' => GameMatch::where('host_user_id', $user->id)->where('status', 'waiting')->latest()->first(),
            'recent' => GameMatch::with(['host', 'guest', 'winner'])
                ->where('status', 'finished')
                ->where(fn ($q) => $q->where('host_user_id', $user->id)->orWhere('guest_user_id', $user->id))
                ->latest('finished_at')->limit(10)->get(),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        // One open lobby per host
        $data = $request->validate(['mode' => ['sometimes', 'string', 'in:versus,coop']]);
        GameMatch::where('host_user_id', $request->user()->id)->where('status', 'waiting')->delete();
        $match = GameMatch::createFor($request->user(), $data['mode'] ?? 'versus');

        return redirect()->route('game', ['code' => $match->code]);
    }

    /** Invite link: /join/{code} joins (or returns to) the match, after login if needed. */
    public function invite(Request $request, string $code): RedirectResponse
    {
        $request->merge(['code' => $code]);

        return $this->join($request);
    }

    public function join(Request $request): RedirectResponse
    {
        $code = strtoupper(trim((string) $request->input('code')));
        $match = GameMatch::where('code', $code)->first();
        $user = $request->user();

        if (! $match) {
            throw ValidationException::withMessages(['code' => 'No match with that code.'])->redirectTo(route('multiplayer'));
        }
        if ($match->isParticipant($user)) {
            return redirect()->route('game', ['code' => $match->code]);
        }
        if ($match->status !== 'waiting') {
            throw ValidationException::withMessages(['code' => 'That match has already started.'])->redirectTo(route('multiplayer'));
        }

        $match->update(['guest_user_id' => $user->id, 'status' => 'active']);

        return redirect()->route('game', ['code' => $match->code]);
    }

    public function status(Request $request, GameMatch $match): JsonResponse
    {
        $this->authorizeParticipant($request, $match);

        return response()->json([
            'status' => $match->status,
            'seed' => $match->seed,
            'mode' => $match->mode,
            'host' => ['id' => $match->host->id, 'name' => $match->host->name],
            'guest' => $match->guest ? ['id' => $match->guest->id, 'name' => $match->guest->name] : null,
        ]);
    }

    public function signal(Request $request, GameMatch $match): JsonResponse
    {
        $this->authorizeParticipant($request, $match);
        $data = $request->validate([
            'type' => ['required', 'string', 'in:offer,answer,candidate,ready,bye,relay-mode'],
            'payload' => ['present', 'string', 'max:20000'],
        ]);

        $signal = $match->signals()->create($data + ['user_id' => $request->user()->id]);

        return response()->json(['id' => $signal->id]);
    }

    public function signals(Request $request, GameMatch $match): JsonResponse
    {
        $this->authorizeParticipant($request, $match);
        $after = (int) $request->query('after', 0);

        $signals = $match->signals()
            ->where('user_id', '!=', $request->user()->id)
            ->where('id', '>', $after)
            ->orderBy('id')
            ->limit(100)
            ->get(['id', 'type', 'payload']);

        return response()->json(['signals' => $signals, 'status' => $match->status]);
    }

    /**
     * Server relay fallback: when WebRTC cannot connect, each client posts its
     * batched lockstep messages here and receives the opponent's in the same call.
     */
    public function relay(Request $request, GameMatch $match): JsonResponse
    {
        $this->authorizeParticipant($request, $match);
        $data = $request->validate([
            'after' => ['required', 'integer', 'min:0'],
            'msgs' => ['present', 'array', 'max:200'],
        ]);

        if (! empty($data['msgs'])) {
            $match->signals()->create([
                'user_id' => $request->user()->id,
                'type' => 'relay',
                'payload' => json_encode($data['msgs']),
            ]);
        }

        $rows = $match->signals()
            ->where('user_id', '!=', $request->user()->id)
            ->where('type', 'relay')
            ->where('id', '>', $data['after'])
            ->orderBy('id')
            ->limit(200)
            ->get(['id', 'payload']);

        $msgs = [];
        foreach ($rows as $row) {
            foreach (json_decode($row->payload, true) ?: [] as $m) {
                $msgs[] = $m;
            }
        }

        return response()->json(['last' => $rows->last()?->id ?? $data['after'], 'msgs' => $msgs, 'status' => $match->status]);
    }

    public function result(Request $request, GameMatch $match): JsonResponse
    {
        $this->authorizeParticipant($request, $match);
        $data = $request->validate([
            'winner' => ['nullable', 'integer', 'in:0,1'],
            'reason' => ['required', 'string', 'max:40'],
            'scores' => ['required', 'array', 'size:2'],
            'scores.*' => ['integer', 'min:0', 'max:100000000'],
            'wave' => ['nullable', 'integer', 'min:1', 'max:1000'],
        ]);

        if ($match->status === 'finished') {
            return response()->json(['recorded' => false]);
        }

        $winnerId = match ($data['winner']) {
            0 => $match->host_user_id,
            1 => $match->guest_user_id,
            default => null,
        };
        $match->update([
            'status' => 'finished',
            'winner_user_id' => $winnerId,
            'host_score' => $data['scores'][0],
            'guest_score' => $data['scores'][1],
            'wave' => $data['wave'] ?? null,
            'reason' => $data['reason'],
            'finished_at' => now(),
        ]);
        $match->signals()->delete();

        return response()->json(['recorded' => true]);
    }

    private function authorizeParticipant(Request $request, GameMatch $match): void
    {
        abort_unless($match->isParticipant($request->user()), 403);
    }
}

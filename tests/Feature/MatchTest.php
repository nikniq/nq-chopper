<?php

namespace Tests\Feature;

use App\Models\GameMatch;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class MatchTest extends TestCase
{
    use RefreshDatabase;

    public function test_multiplayer_requires_login(): void
    {
        $this->get('/multiplayer')->assertRedirect(route('login'));
        $this->get('/play/ABCDEF')->assertForbidden();
    }

    public function test_host_creates_match_and_guest_joins(): void
    {
        $host = User::factory()->create(['name' => 'Host']);
        $guest = User::factory()->create(['name' => 'Guest']);

        $this->actingAs($host)->get('/multiplayer')->assertOk()->assertSee('Host a match');
        $response = $this->actingAs($host)->post('/matches');
        $match = GameMatch::first();
        $response->assertRedirect(route('game', ['code' => $match->code]));
        $this->assertSame('waiting', $match->status);
        $this->assertSame(6, strlen($match->code));

        // Host's game page carries host role and no opponent yet
        $this->actingAs($host)->get('/play/'.$match->code)->assertOk()
            ->assertSee('"role":"host"', false)->assertSee('"opponent":null', false)->assertSee('js/sim.js');

        // Strangers cannot see it
        $this->actingAs(User::factory()->create())->get('/play/'.$match->code)->assertForbidden();

        // Bad code
        $this->actingAs($guest)->from('/multiplayer')->post('/matches/join', ['code' => 'NOPE'])
            ->assertRedirect('/multiplayer')->assertSessionHasErrors('code');

        $this->actingAs($guest)->post('/matches/join', ['code' => strtolower($match->code)])
            ->assertRedirect(route('game', ['code' => $match->code]));
        $match->refresh();
        $this->assertSame('active', $match->status);
        $this->assertSame($guest->id, $match->guest_user_id);

        $this->actingAs($guest)->get('/play/'.$match->code)->assertOk()
            ->assertSee('"role":"guest"', false)->assertSee('"name":"Host"', false);

        // A third player cannot join an active match
        $this->actingAs(User::factory()->create())->from('/multiplayer')->post('/matches/join', ['code' => $match->code])
            ->assertSessionHasErrors('code');

        $this->actingAs($host)->getJson(route('matches.status', $match))
            ->assertOk()->assertJsonPath('guest.name', 'Guest')->assertJsonPath('seed', $match->seed);
    }

    public function test_signals_are_relayed_only_to_the_other_participant(): void
    {
        $host = User::factory()->create();
        $guest = User::factory()->create();
        $match = GameMatch::createFor($host);
        $match->update(['guest_user_id' => $guest->id, 'status' => 'active']);

        $this->actingAs($host)->postJson(route('matches.signal', $match), ['type' => 'offer', 'payload' => '{"sdp":"x"}'])->assertOk();
        $this->actingAs($host)->postJson(route('matches.signal', $match), ['type' => 'candidate', 'payload' => '{"c":1}'])->assertOk();
        $this->actingAs($guest)->postJson(route('matches.signal', $match), ['type' => 'answer', 'payload' => '{"sdp":"y"}'])->assertOk();
        $this->actingAs($guest)->postJson(route('matches.signal', $match), ['type' => 'hack', 'payload' => '{}'])->assertUnprocessable();

        $forGuest = $this->actingAs($guest)->getJson(route('matches.signals', $match).'?after=0')->assertOk()->json('signals');
        $this->assertSame(['offer', 'candidate'], array_column($forGuest, 'type'));

        $forHost = $this->actingAs($host)->getJson(route('matches.signals', $match).'?after=0')->assertOk()->json('signals');
        $this->assertSame(['answer'], array_column($forHost, 'type'));

        $afterId = $forGuest[0]['id'];
        $later = $this->actingAs($guest)->getJson(route('matches.signals', $match).'?after='.$afterId)->json('signals');
        $this->assertSame(['candidate'], array_column($later, 'type'));

        $this->actingAs(User::factory()->create())->getJson(route('matches.signals', $match))->assertForbidden();
    }

    public function test_result_is_recorded_once_and_listed(): void
    {
        $host = User::factory()->create(['name' => 'Alpha']);
        $guest = User::factory()->create(['name' => 'Bravo']);
        $match = GameMatch::createFor($host);
        $match->update(['guest_user_id' => $guest->id, 'status' => 'active']);
        $match->signals()->create(['user_id' => $host->id, 'type' => 'offer', 'payload' => '{}']);

        $this->actingAs($guest)->postJson(route('matches.result', $match), ['winner' => 1, 'reason' => 'BASE DESTROYED', 'scores' => [1200, 3400]])
            ->assertOk()->assertJson(['recorded' => true]);
        $this->actingAs($host)->postJson(route('matches.result', $match), ['winner' => 0, 'reason' => 'BASE DESTROYED', 'scores' => [1200, 3400]])
            ->assertOk()->assertJson(['recorded' => false]);

        $match->refresh();
        $this->assertSame('finished', $match->status);
        $this->assertSame($guest->id, $match->winner_user_id);
        $this->assertSame(0, $match->signals()->count());

        $this->actingAs($guest)->get('/multiplayer')->assertOk()->assertSeeInOrder(['Alpha', 'Bravo', '1200 – 3400', 'Won']);
        $this->actingAs($host)->get('/multiplayer')->assertSee('Lost');
    }
}

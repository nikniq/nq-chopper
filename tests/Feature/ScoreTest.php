<?php

namespace Tests\Feature;

use App\Models\Score;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ScoreTest extends TestCase
{
    use RefreshDatabase;

    public function test_guests_cannot_submit_scores_and_game_page_has_no_score_url(): void
    {
        $this->postJson('/scores', ['score' => 10, 'wave' => 1, 'rescued' => 0])->assertUnauthorized();
        $this->get('/play')->assertOk()->assertSee('scoreUrl: null', false);
    }

    public function test_logged_in_player_submits_score_and_sees_rank(): void
    {
        $rival = User::factory()->create();
        $rival->scores()->create(['score' => 5000, 'wave' => 3, 'rescued' => 12]);
        $me = User::factory()->create(['name' => 'Goose']);

        $this->actingAs($me)->get('/play')->assertSee(json_encode(route('scores.store')), false);

        $this->actingAs($me)->postJson('/scores', ['score' => 1200, 'wave' => 2, 'rescued' => 6])
            ->assertOk()->assertJson(['saved' => true, 'best' => 1200, 'rank' => 2]);
        $this->actingAs($me)->postJson('/scores', ['score' => 9000, 'wave' => 5, 'rescued' => 20])
            ->assertOk()->assertJson(['best' => 9000, 'rank' => 1]);

        $this->assertDatabaseCount('scores', 3);
    }

    public function test_score_validation(): void
    {
        $this->actingAs(User::factory()->create())
            ->postJson('/scores', ['score' => -1, 'wave' => 0])
            ->assertUnprocessable()->assertJsonValidationErrors(['score', 'wave', 'rescued']);
    }

    public function test_leaderboard_shows_each_players_best_once(): void
    {
        $a = User::factory()->create(['name' => 'Alpha']);
        $b = User::factory()->create(['name' => 'Bravo']);
        $a->scores()->create(['score' => 300, 'wave' => 1, 'rescued' => 1]);
        $a->scores()->create(['score' => 800, 'wave' => 2, 'rescued' => 4]);
        $b->scores()->create(['score' => 500, 'wave' => 1, 'rescued' => 2]);

        $leaders = Score::leaderboard();
        $this->assertSame(['Alpha', 'Bravo'], $leaders->pluck('user.name')->all());
        $this->assertSame([800, 500], $leaders->pluck('score')->all());

        $this->actingAs($b)->get('/')->assertOk()->assertSeeInOrder(['Alpha', '800', 'Bravo', '500'])->assertSee('Your best');
    }
}

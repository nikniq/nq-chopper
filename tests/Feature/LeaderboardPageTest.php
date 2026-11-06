<?php

namespace Tests\Feature;

use App\Models\GameMatch;
use App\Models\Score;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class LeaderboardPageTest extends TestCase
{
    use RefreshDatabase;

    public function test_period_boards_and_personal_rank(): void
    {
        $old = User::factory()->create(['name' => 'Oldtimer']);
        $new = User::factory()->create(['name' => 'Newbie']);
        $me = User::factory()->create(['name' => 'Me']);
        $s = $old->scores()->create(['score' => 9000, 'wave' => 6, 'rescued' => 20]);
        $s->forceFill(['created_at' => now()->subMonths(2)])->save();
        $new->scores()->create(['score' => 3000, 'wave' => 3, 'rescued' => 8]);
        $me->scores()->create(['score' => 2000, 'wave' => 2, 'rescued' => 5]);
        $me->scores()->create(['score' => 1000, 'wave' => 1, 'rescued' => 2]);

        $this->get('/leaderboard')->assertOk()->assertSeeInOrder(['Oldtimer', 'Newbie', 'Me']);
        $this->get('/leaderboard?board=monthly')->assertOk()->assertSeeInOrder(['Newbie', 'Me'])->assertDontSee('Oldtimer');
        $this->get('/leaderboard?board=weekly')->assertOk()->assertSee('Newbie')->assertDontSee('Oldtimer');
        $this->get('/leaderboard?board=bogus')->assertNotFound();

        $this->actingAs($me)->get('/leaderboard')->assertSee('Your rank: <strong>#3</strong>', false)->assertSee('2,000');
        $this->actingAs($me)->get('/leaderboard?board=monthly')->assertSee('#2</strong>', false);
        $this->actingAs($old)->get('/leaderboard?board=weekly')->assertSee('no run on this board');
    }

    public function test_daily_archive_navigation(): void
    {
        $a = User::factory()->create(['name' => 'Yesterday']);
        $b = User::factory()->create(['name' => 'TodayPilot']);
        $yesterday = now('UTC')->subDay()->toDateString();
        $a->scores()->create(['score' => 500, 'wave' => 1, 'rescued' => 1, 'mode' => 'daily', 'day' => $yesterday]);
        $b->scores()->create(['score' => 700, 'wave' => 1, 'rescued' => 2, 'mode' => 'daily', 'day' => Score::today()]);

        $this->get('/leaderboard?board=daily')->assertOk()->assertSee('TodayPilot')->assertDontSee('Yesterday')->assertSee($yesterday);
        $this->get('/leaderboard?board=daily&day='.$yesterday)->assertOk()->assertSee('Yesterday')->assertDontSee('TodayPilot')->assertSee(Score::today().' &rarr;', false);
        $this->get('/leaderboard?board=daily&day='.now('UTC')->addDays(3)->toDateString())->assertNotFound();
        $this->get('/leaderboard?board=daily&day=not-a-date')->assertNotFound();
        $this->get('/')->assertSee(route('leaderboard'));
    }

    public function test_board_totals_gap_and_tied_ranks(): void
    {
        $a = User::factory()->create(['name' => 'Ace']);
        $b = User::factory()->create(['name' => 'Bee']);
        $c = User::factory()->create(['name' => 'Cee']);
        $a->scores()->create(['score' => 5000, 'wave' => 7, 'rescued' => 10]);
        $b->scores()->create(['score' => 5000, 'wave' => 4, 'rescued' => 6]);
        $c->scores()->create(['score' => 4000, 'wave' => 3, 'rescued' => 4]);

        $this->assertSame(['pilots' => 3, 'runs' => 3, 'rescued' => 20, 'topWave' => 7], Score::periodTotals('alltime'));
        $this->actingAs($c)->get('/leaderboard')->assertSee('1,000 behind');
        $this->assertSame([1, 1, 3], collect(Score::periodBoard('alltime'))->map(fn ($r) => Score::periodRank('alltime', null, $r->user)['rank'])->all());
        $this->get('/leaderboard')->assertSeeInOrder(['<td>1</td>', 'Ace', '<td>1</td>', 'Bee', '<td>3</td>', 'Cee'], false);
    }

    public function test_duels_board_ignores_coop_and_profile_shows_stats(): void
    {
        $a = User::factory()->create(['name' => 'Winner']);
        $b = User::factory()->create(['name' => 'Loser']);
        $finish = fn ($mode, $win) => GameMatch::create(['code' => strtoupper(Str::random(6)), 'host_user_id' => $a->id, 'guest_user_id' => $b->id, 'seed' => 1, 'mode' => $mode, 'status' => 'finished', 'winner_user_id' => $win, 'host_score' => 1, 'guest_score' => 0, 'finished_at' => now()]);
        $finish('versus', $a->id);
        $finish('versus', $b->id);
        $finish('versus', $a->id);
        $finish('coop', null);

        $board = GameMatch::duelBoard();
        $this->assertSame(['Winner', 2, 3, 67], [$board[0]['user']->name, $board[0]['wins'], $board[0]['played'], $board[0]['rate']]);
        $this->get('/leaderboard?board=duels')->assertOk()->assertSeeInOrder(['Winner', '67%', 'Loser', '33%']);

        $a->scores()->create(['score' => 1000, 'wave' => 2, 'rescued' => 3]);
        $a->scores()->create(['score' => 3000, 'wave' => 3, 'rescued' => 4]);
        $a->scores()->create(['score' => 500, 'wave' => 1, 'rescued' => 1, 'mode' => 'daily', 'day' => Score::today()]);
        $this->get(route('profile', $a))->assertOk()
            ->assertSee('2 / 3')->assertSee('Average score')->assertSee('2,000')->assertSee('#1')->assertSee('Score trend')->assertSee('polyline', false);
        $this->get(route('profile', $b))->assertOk()->assertDontSee('Score trend');
    }
}

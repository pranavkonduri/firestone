import { AfterContentInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ViewRef } from '@angular/core';
import { normalizeHeroCardId } from '@firestone-hs/reference-data';
import { BgsActiveTimeFilterType } from '@firestone/battlegrounds/data-access';
import {
	BgsRankFilterType,
	PatchesConfigService,
	PatchInfo,
	PreferencesService,
} from '@firestone/shared/common/service';
import { invertDirection, SimpleBarChartData, SortCriteria, SortDirection } from '@firestone/shared/common/view';
import { AbstractSubscriptionComponent, groupByFunction } from '@firestone/shared/framework/common';
import { CardsFacadeService, waitForReady } from '@firestone/shared/framework/core';
import { GameStat, GameStatsLoaderService } from '@firestone/stats/data-access';
import { BehaviorSubject, combineLatest, distinctUntilChanged, Observable, shareReplay, takeUntil, tap } from 'rxjs';
import { BattlegroundsYourStat } from './your-stats.model';

@Component({
	selector: 'battlegrounds-desktop-your-stats',
	styleUrls: [`./battlegrounds-personal-stats-columns.scss`, `./battlegrounds-desktop-your-stats.component.scss`],
	template: `
		<section class="battlegrounds-desktop-your-stats">
			<div class="summary">
				<div class="group highest-mmr">
					<div class="label">Highest Rating</div>
					<div class="value">{{ highestMmr$ | async }}</div>
				</div>
				<div class="group matches">
					<div class="label">Matches</div>
					<div class="value">{{ totalGames$ | async }}</div>
				</div>
				<div class="group time">
					<div class="label">Time played</div>
					<div class="value">{{ timePlayed$ | async }}</div>
				</div>
				<div class="group placement-summary">
					<basic-bar-chart-2
						class="placement-distribution"
						[data]="placementChartData$ | async"
						[id]="'placementDistributionGlobal'"
						[midLineValue]="100 / 8"
						[offsetValue]="1"
					></basic-bar-chart-2>
				</div>
				<!-- MMR Graph (small)? -->
			</div>
			<ng-container *ngIf="{ stats: stats$ | async } as value">
				<ng-container *ngIf="value.stats?.length > 0">
					<div class="stats">
						<div class="header" *ngIf="sortCriteria$ | async as sort">
							<div class="portrait"></div>
							<sortable-table-label
								class="cell hero-details"
								[name]="'app.battlegrounds.tier-list.header-hero-details' | fsTranslate"
								[sort]="sort"
								[criteria]="'name'"
								(sortClick)="onSortClick($event)"
							>
							</sortable-table-label>
							<sortable-table-label
								class="cell position"
								[name]="'app.battlegrounds.tier-list.header-average-position' | fsTranslate"
								[sort]="sort"
								[criteria]="'position'"
								(sortClick)="onSortClick($event)"
							>
							</sortable-table-label>
							<sortable-table-label
								class="cell games-played"
								[name]="'app.battlegrounds.tier-list.header-games-played' | fsTranslate"
								[sort]="sort"
								[criteria]="'games-played'"
								(sortClick)="onSortClick($event)"
							>
							</sortable-table-label>
							<sortable-table-label
								class="cell net-mmr"
								[name]="'app.battlegrounds.tier-list.header-net-mmr' | fsTranslate"
								[helpTooltip]="'app.battlegrounds.personal-stats.hero.net-mmr-tooltip' | fsTranslate"
								[sort]="sort"
								[criteria]="'net-mmr'"
								(sortClick)="onSortClick($event)"
							>
							</sortable-table-label>
							<div
								class="cell placement"
								[fsTranslate]="'app.battlegrounds.tier-list.header-placement-distribution'"
							></div>
						</div>
						<div class="stats-list">
							<battlegrounds-presonal-stats-info
								*ngFor="let stat of value.stats"
								class="stat"
								[stat]="stat"
							></battlegrounds-presonal-stats-info>
						</div>
					</div>
				</ng-container>
				<div class="empty-state-container" *ngIf="!value.stats?.length">
					<battlegrounds-empty-state
						[subtitle]="'app.battlegrounds.personal-stats.hero.empty-state-text' | fsTranslate"
					></battlegrounds-empty-state>
				</div>
			</ng-container>
		</section>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BattlegroundsDesktopYourStatsComponent extends AbstractSubscriptionComponent implements AfterContentInit {
	stats$: Observable<readonly BattlegroundsYourStat[]>;
	highestMmr$: Observable<number>;
	totalGames$: Observable<number>;
	timePlayed$: Observable<string>;
	placementChartData$: Observable<SimpleBarChartData[]>;

	sortCriteria$: Observable<SortCriteria<ColumnSortType>>;

	private sortCriteria$$ = new BehaviorSubject<SortCriteria<ColumnSortType>>({
		criteria: 'games-played',
		direction: 'desc',
	});

	constructor(
		protected override readonly cdr: ChangeDetectorRef,
		private readonly prefs: PreferencesService,
		private readonly gameStats: GameStatsLoaderService,
		private readonly allCards: CardsFacadeService,
		private readonly patch: PatchesConfigService,
	) {
		super(cdr);
	}

	async ngAfterContentInit() {
		await waitForReady(this.prefs, this.gameStats, this.patch);

		this.sortCriteria$ = this.sortCriteria$$.asObservable();
		const prefs$ = this.prefs.preferences$$.pipe(
			this.mapData((prefs) => ({
				mode: prefs.bgsActiveGameMode,
				time: prefs.bgsActiveTimeFilter,
				rank: prefs.bgsActiveRankFilter,
			})),
			distinctUntilChanged((a, b) => a.mode === b.mode && a.time === b.time && a.rank === b.rank),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);

		const bgGames$ = this.gameStats.gameStats$$.pipe(
			this.mapData(
				(stats) =>
					stats?.stats
						?.filter((stat) => stat.isBattlegrounds())
						.filter(
							(stat) =>
								!!stat.additionalResult?.length &&
								!!stat.playerRank?.length &&
								!!stat.newPlayerRank?.length,
						)
						// Remove games where the rank difference is too big, as it's likely a bug due to season reset
						.filter((stat) => Math.abs(+stat.playerRank - +stat.newPlayerRank) < 500) ?? [],
			),
			distinctUntilChanged((a, b) => a.length === b.length),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);

		const filteredGames$ = combineLatest([bgGames$, prefs$, this.patch.currentBattlegroundsMetaPatch$$]).pipe(
			this.mapData(([games, prefs, patch]) =>
				games
					.filter((game) => this.filterGameMode(game, prefs.mode))
					.filter((game) => this.filterTime(game, prefs.time, patch))
					.filter((game) => this.filterRank(game, prefs.rank)),
			),
			distinctUntilChanged((a, b) => a.length === b.length),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);

		this.highestMmr$ = filteredGames$.pipe(
			tap((games) =>
				console.log(
					'highest mmr games',
					games.filter((game) => +game.newPlayerRank > 6000),
				),
			),
			this.mapData((games) => Math.max(...games.map((game) => +game.newPlayerRank))),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);
		this.totalGames$ = filteredGames$.pipe(
			this.mapData((games) => games.length),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);
		this.timePlayed$ = filteredGames$.pipe(
			this.mapData((games) => {
				const totalSeconds = games.map((game) => game.gameDurationSeconds).reduce((a, b) => a + b, 0);
				const totalMinutes = Math.floor(totalSeconds / 60);
				const totalHours = Math.floor(totalMinutes / 60);
				return `${totalHours}h ${totalMinutes % 60}m`;
			}),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);
		this.placementChartData$ = filteredGames$.pipe(
			this.mapData((games) => {
				const totalGames = games.length;
				const placementDistribution = [];
				for (let i = 1; i <= 8; i++) {
					const totalMatches = games.filter((game) => +game.additionalResult === i).length;
					placementDistribution.push({ label: i, value: (totalMatches * 100) / totalGames });
				}

				return [{ data: placementDistribution }];
			}),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);

		const statsType$ = this.prefs.preferences$$.pipe(
			this.mapData((prefs) => prefs.bgsYourStatsTypeFilter),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);

		const unsortedStats$ = combineLatest([filteredGames$, statsType$]).pipe(
			this.mapData(([games, statsType]) => this.buildStats(games, statsType)),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);
		this.stats$ = combineLatest([unsortedStats$, this.sortCriteria$$]).pipe(
			this.mapData(([stats, sortCriteria]) => [...stats].sort((a, b) => this.sortCards(a, b, sortCriteria))),
		);

		if (!(this.cdr as ViewRef)?.destroyed) {
			this.cdr.detectChanges();
		}
	}

	onSortClick(rawCriteria: string) {
		const criteria: ColumnSortType = rawCriteria as ColumnSortType;
		this.sortCriteria$$.next({
			criteria: criteria,
			direction:
				criteria === this.sortCriteria$$.value?.criteria
					? invertDirection(this.sortCriteria$$.value.direction)
					: 'desc',
		});
	}

	private buildStats(games: readonly GameStat[], statsType: 'hero' | 'trinket'): readonly BattlegroundsYourStat[] {
		switch (statsType) {
			case 'hero':
				return this.buildHeroStats(games);
			case 'trinket':
				return this.buildTrinketStats(games);
		}
	}
	private buildTrinketStats(games: readonly GameStat[]): readonly BattlegroundsYourStat[] {
		const denormalized: readonly GameStat[] = games
			.filter((g) => !!g.bgsTrinkets?.length)
			.flatMap((g) => g.bgsTrinkets.map((t) => GameStat.create({ ...g, bgsTrinkets: [t] })));
		const groupedByTrinket = groupByFunction((game: GameStat) => game.bgsTrinkets[0])(denormalized);
		const result: readonly BattlegroundsYourStat[] = Object.keys(groupedByTrinket).map((trinketCardId) => {
			const trinketGames = groupedByTrinket[trinketCardId];
			const totalMmr = trinketGames.map((g) => +g.newPlayerRank - +g.playerRank).reduce((a, b) => a + b, 0);
			const result: BattlegroundsYourStat = {
				cardId: trinketCardId,
				name: this.allCards.getCard(trinketCardId)?.name,
				totalMatches: trinketGames.length,
				averagePosition:
					trinketGames.map((game) => +game.additionalResult).reduce((a, b) => a + b, 0) / trinketGames.length,
				placementDistribution: this.buildPlacementDistribution(trinketGames),
				pickRate: null,
				netMmr: trinketGames?.length ? totalMmr / trinketGames.length : null,
			};
			return result;
		});
		return result;
	}

	private buildHeroStats(games: readonly GameStat[]): readonly BattlegroundsYourStat[] {
		const groupedByHero = groupByFunction((game: GameStat) =>
			normalizeHeroCardId(game.playerCardId, this.allCards),
		)(games);
		return Object.keys(groupedByHero).map((heroCardId) => {
			const heroGames = groupedByHero[heroCardId];
			const totalMmr = heroGames.map((g) => +g.newPlayerRank - +g.playerRank).reduce((a, b) => a + b, 0);
			const result: BattlegroundsYourStat = {
				cardId: heroCardId,
				name: this.allCards.getCard(heroCardId)?.name,
				totalMatches: heroGames.length,
				averagePosition:
					heroGames.map((game) => +game.additionalResult).reduce((a, b) => a + b, 0) / heroGames.length,
				placementDistribution: this.buildPlacementDistribution(heroGames),
				pickRate: null,
				netMmr: heroGames?.length ? totalMmr / heroGames.length : null,
			};
			return result;
		});
	}

	private buildPlacementDistribution(
		games: readonly GameStat[],
	): readonly { readonly placement: number; readonly totalMatches: number }[] {
		const distribution = [];
		for (let i = 1; i <= 8; i++) {
			const totalMatches = games.filter((game) => +game.additionalResult === i).length;
			distribution.push({ placement: i, totalMatches: totalMatches });
		}
		return distribution;
	}

	private filterGameMode(game: GameStat, mode: 'battlegrounds' | 'battlegrounds-duo'): boolean {
		return game.gameMode === mode;
	}

	private filterTime(game: GameStat, time: BgsActiveTimeFilterType, patch: PatchInfo): boolean {
		switch (time) {
			case 'all-time':
				return true;
			case 'past-three':
				return game.creationTimestamp > Date.now() - 3 * 24 * 60 * 60 * 1000;
			case 'past-seven':
				return game.creationTimestamp > Date.now() - 7 * 24 * 60 * 60 * 1000;
			case 'last-patch':
				return game.creationTimestamp > new Date(patch.date).getTime();
		}
	}

	private filterRank(game: GameStat, rank: BgsRankFilterType): boolean {
		return true;
	}

	private sortCards(
		a: BattlegroundsYourStat,
		b: BattlegroundsYourStat,
		sortCriteria: SortCriteria<ColumnSortType>,
	): number {
		switch (sortCriteria?.criteria) {
			case 'name':
				return this.sortByName(a, b, sortCriteria.direction);
			case 'position':
				return this.sortByPosition(a, b, sortCriteria.direction);
			case 'games-played':
				return this.sortByGamesPlayed(a, b, sortCriteria.direction);
			case 'net-mmr':
				return this.sortByNetMmr(a, b, sortCriteria.direction);
			default:
				return 0;
		}
	}

	private sortByGamesPlayed(a: BattlegroundsYourStat, b: BattlegroundsYourStat, direction: SortDirection): number {
		return direction === 'asc' ? a.totalMatches - b.totalMatches : b.totalMatches - a.totalMatches;
	}

	private sortByNetMmr(a: BattlegroundsYourStat, b: BattlegroundsYourStat, direction: SortDirection): number {
		return direction === 'asc' ? a.netMmr - b.netMmr : b.netMmr - a.netMmr;
	}

	private sortByPosition(a: BattlegroundsYourStat, b: BattlegroundsYourStat, direction: SortDirection): number {
		return direction === 'asc' ? a.averagePosition - b.averagePosition : b.averagePosition - a.averagePosition;
	}

	private sortByName(a: BattlegroundsYourStat, b: BattlegroundsYourStat, direction: SortDirection): number {
		const aData = this.allCards.getCard(a.cardId)?.name;
		const bData = this.allCards.getCard(b.cardId)?.name;
		return direction === 'asc' ? aData.localeCompare(bData) : bData.localeCompare(aData);
	}
}

type ColumnSortType = 'name' | 'position' | 'net-mmr' | 'games-played';

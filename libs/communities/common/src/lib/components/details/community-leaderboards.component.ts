/* eslint-disable no-mixed-spaces-and-tabs */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable @angular-eslint/template/eqeqeq */
/* eslint-disable @angular-eslint/template/no-negated-async */
import { AfterContentInit, ChangeDetectionStrategy, ChangeDetectorRef, Component, ViewRef } from '@angular/core';
import { CommunityInfo, LeaderboardEntry, LeaderboardEntryArena } from '@firestone-hs/communities';
import { StatGameFormatType, StatGameModeType } from '@firestone/shared/common/service';
import { AbstractSubscriptionComponent } from '@firestone/shared/framework/common';
import { ILocalizationService, waitForReady } from '@firestone/shared/framework/core';
import { GameStat } from '@firestone/stats/data-access';
import {
	BehaviorSubject,
	Observable,
	combineLatest,
	debounceTime,
	distinctUntilChanged,
	filter,
	map,
	shareReplay,
	takeUntil,
	tap,
} from 'rxjs';
import { CommunityNavigationService } from '../../services/community-navigation.service';
import { PersonalCommunitiesService } from '../../services/personal-communities.service';

@Component({
	selector: 'community-leaderboards',
	styleUrls: [`./community-leaderboards.component.scss`],
	template: `
		<div class="leaderboards" *ngIf="{ leaderboard: leaderboard$ | async } as value">
			<ul class="tabs">
				<div
					class="tab"
					*ngFor="let tab of tabs$ | async; trackBy: trackByTab"
					[ngClass]="{ selected: tab.selected }"
					(click)="selectTab(tab)"
				>
					<div class="text">{{ tab.name }}</div>
				</div>
			</ul>
			<div class="leaderboard" *ngIf="value.leaderboard as leaderboard">
				<div class="leaderboard-header">
					<div class="cell rank" [fsTranslate]="'app.communities.details.leaderboards.rank-header'"></div>
					<div
						class="cell player-rank"
						[fsTranslate]="'app.communities.details.leaderboards.rating-header'"
					></div>
					<div
						class="cell runs-completed"
						[fsTranslate]="'app.communities.details.leaderboards.runs-completed-header'"
						*ngIf="showRunsCompleted$ | async"
					></div>
					<div
						class="cell player-name"
						[fsTranslate]="'app.communities.details.leaderboards.name-header'"
					></div>
				</div>
				<div class="entries">
					<div class="leaderboard-entry" *ngFor="let entry of leaderboard">
						<div class="cell rank">{{ entry.rank }}</div>
						<rank-image class="cell player-rank" [stat]="entry.playerRank"></rank-image>
						<div class="cell runs-completed" *ngIf="showRunsCompleted$ | async">
							{{ entry.runsCompleted }}
						</div>
						<div class="cell player-name">{{ entry.playerName }}</div>
					</div>
				</div>
			</div>
			<div
				class="leaderboard empty"
				*ngIf="!value.leaderboard?.length"
				[fsTranslate]="'app.communities.details.leaderboards.empty-leaderboard'"
			></div>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityLeaderboardsComponent extends AbstractSubscriptionComponent implements AfterContentInit {
	showRunsCompleted$: Observable<boolean>;
	tabs$: Observable<readonly Tab[]>;
	leaderboard$: Observable<readonly InternalLeaderboardEntry[] | null>;

	private selectedTab$$ = new BehaviorSubject<string>('standard');

	constructor(
		protected override readonly cdr: ChangeDetectorRef,
		private readonly nav: CommunityNavigationService,
		private readonly personalCommunities: PersonalCommunitiesService,
		private readonly i18n: ILocalizationService,
	) {
		super(cdr);
	}

	async ngAfterContentInit() {
		await waitForReady(this.personalCommunities, this.nav);
		this.personalCommunities.selectedCommunity$$
			.pipe(
				this.mapData((community) => community?.defaultTab),
				filter((tab) => !!tab),
			)
			.subscribe((tab) => {
				this.selectedTab$$.next(tab!);
			});
		const selectedTab$ = this.selectedTab$$.pipe(
			distinctUntilChanged((a, b) => a === b),
			tap((tab) => console.debug('selected tab', tab)),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);
		this.leaderboard$ = combineLatest([selectedTab$, this.personalCommunities.selectedCommunity$$]).pipe(
			debounceTime(100),
			filter(([selectedTab, community]) => !!community),
			map(([selectedTab, community]) => {
				const sourceLeaderboard = this.getSourceLeaderboard(selectedTab, community!);
				const displayedLeaderboard = this.buildLeaderboard(sourceLeaderboard, selectedTab);
				return !!displayedLeaderboard?.length ? displayedLeaderboard : null;
			}),
			shareReplay(1),
			takeUntil(this.destroyed$),
		);

		const allTabs = ['standard', 'wild', 'twist', 'battlegrounds', 'battlegrounds-duo', 'arena'].map((tab) => ({
			id: tab,
			name: this.buildTabName(tab),
		}));
		this.tabs$ = selectedTab$.pipe(
			this.mapData((selectedTab) =>
				allTabs.map((tab) =>
					tab.id === selectedTab
						? {
								...tab,
								selected: tab.id === selectedTab,
						  }
						: tab,
				),
			),
		);
		this.showRunsCompleted$ = selectedTab$.pipe(this.mapData((selectedTab) => selectedTab === 'arena'));

		if (!(this.cdr as ViewRef).destroyed) {
			this.cdr.detectChanges();
		}
	}

	trackByTab(index: number, item: Tab) {
		return item.id;
	}

	selectTab(tab: Tab) {
		this.selectedTab$$.next(tab.id);
	}

	private buildTabName(tab: string): string {
		switch (tab) {
			case 'standard':
				return this.i18n.translateString('global.format.standard')!;
			case 'wild':
				return this.i18n.translateString('global.format.wild')!;
			case 'twist':
				return this.i18n.translateString('global.format.twist')!;
			case 'battlegrounds':
				return this.i18n.translateString('global.game-mode.battlegrounds')!;
			case 'battlegrounds-duo':
				return this.i18n.translateString('global.game-mode.battlegrounds-duo')!;
			case 'arena':
				return this.i18n.translateString('global.game-mode.arena')!;
			default:
				return 'Unknown';
		}
	}

	private buildLeaderboard(
		sourceLeaderboard: readonly LeaderboardEntry[] | null,
		selectedTab: string,
	): readonly InternalLeaderboardEntry[] {
		if (!sourceLeaderboard?.length) {
			return [];
		}

		const gameMode: StatGameModeType = this.toGameMode(selectedTab);
		const gameFormat: StatGameFormatType = this.toGameFormat(selectedTab);
		return sourceLeaderboard.map((entry, index) => {
			const rankStat: GameStat = {
				playerRank: gameMode === 'arena' ? parseFloat(entry.currentRank).toFixed(2) : entry.currentRank,
				gameMode: gameMode,
				gameFormat: gameFormat,
			} as GameStat;
			const runsCompleted = !!(entry as LeaderboardEntryArena)?.runsPerDay
				? Object.values((entry as LeaderboardEntryArena).runsPerDay).flatMap((runs) => runs).length
				: null;
			return {
				rank: index + 1,
				playerName: entry.displayName,
				playerRank: rankStat,
				runsCompleted: runsCompleted,
			};
		});
	}

	private toGameMode(selectedTab: string): StatGameModeType {
		switch (selectedTab) {
			case 'standard':
			case 'wild':
			case 'twist':
				return 'ranked';
			case 'battlegrounds':
				return 'battlegrounds';
			case 'battlegrounds-duo':
				return 'battlegrounds-duo';
			case 'arena':
				return 'arena';
			default:
				return selectedTab as StatGameModeType;
		}
	}

	private toGameFormat(selectedTab: string): StatGameFormatType {
		switch (selectedTab) {
			case 'standard':
				return 'standard';
			case 'wild':
				return 'wild';
			case 'twist':
				return 'standard';
			default:
				return 'wild';
		}
	}

	private getSourceLeaderboard(selectedTab: string, community: CommunityInfo): readonly LeaderboardEntry[] | null {
		switch (selectedTab) {
			case 'standard':
				return community.standardInfo?.leaderboard;
			case 'wild':
				return community.wildInfo?.leaderboard;
			case 'twist':
				return community.twistInfo?.leaderboard;
			case 'battlegrounds':
				return community.battlegroundsInfo?.leaderboard;
			case 'battlegrounds-duo':
				return community.battlegroundsDuoInfo?.leaderboard;
			case 'arena':
				return community.arenaInfo?.leaderboard;
			default:
				return null;
		}
	}
}

interface Tab {
	id: string;
	name: string;
	selected?: boolean;
}

interface InternalLeaderboardEntry {
	rank: number;
	playerName: string;
	playerRank: GameStat;
	runsCompleted?: number | null;
}

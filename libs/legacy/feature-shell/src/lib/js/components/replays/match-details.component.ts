import { AfterContentInit, ChangeDetectionStrategy, ChangeDetectorRef, Component } from '@angular/core';
import { Observable } from 'rxjs';
import { MatchDetail } from '../../models/mainwindow/replays/match-detail';
import { AppUiStoreFacadeService } from '../../services/ui-store/app-ui-store-facade.service';
import { AbstractSubscriptionStoreComponent } from '../abstract-subscription-store.component';

@Component({
	selector: 'match-details',
	styleUrls: [`../../../css/component/replays/match-details.component.scss`],
	template: `
		<div
			class="match-details {{ value.selectedView }}"
			*ngIf="{ selectedView: selectedView$ | async, selectedReplay: selectedReplay$ | async } as value"
		>
			<replay-info
				[replay]="value.selectedReplay?.replayInfo"
				*ngIf="value.selectedReplay?.replayInfo"
			></replay-info>
			<game-replay [replay]="value.selectedReplay" *ngIf="value.selectedView === 'replay'"></game-replay>
			<bgs-post-match-stats
				*ngIf="value.selectedView === 'match-stats'"
				[panel]="value.selectedReplay?.bgsPostMatchStatsPanel"
				[mainPlayerId]="value.selectedReplay?.bgsPostMatchStatsPanel?.player?.playerId"
				[mmr]="parseInt(value.selectedReplay?.replayInfo?.playerRank)"
				[showSocialShares]="false"
				[emptyTitle]="'app.replays.bg-stats.empty-state-title' | owTranslate"
				[emptySubtitle]="'app.replays.bg-stats.empty-state-subtitle' | owTranslate"
				[loadingTitle]="null"
				[loadingSubtitle]="null"
				[hideDefaultLoadingSubtitle]="true"
				[loadingSvg]="'loading-spiral'"
				[showHints]="false"
			></bgs-post-match-stats>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MatchDetailsComponent extends AbstractSubscriptionStoreComponent implements AfterContentInit {
	selectedView$: Observable<string>;
	selectedReplay$: Observable<MatchDetail>;

	constructor(protected readonly store: AppUiStoreFacadeService, protected readonly cdr: ChangeDetectorRef) {
		super(store, cdr);
	}

	ngAfterContentInit() {
		this.selectedView$ = this.store
			.listen$(([main, nav, prefs]) => nav.navigationReplays)
			.pipe(this.mapData(([nav]) => (nav.currentView === 'match-details' ? nav.selectedTab : null)));
		this.selectedReplay$ = this.store
			.listen$(([main, nav, prefs]) => nav.navigationReplays.selectedReplay)
			.pipe(this.mapData(([selectedReplay]) => selectedReplay));
	}

	parseInt(value: string | number): number {
		return parseInt('' + value);
	}
}

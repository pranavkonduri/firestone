import { AfterContentInit, ChangeDetectionStrategy, ChangeDetectorRef, Component } from '@angular/core';
import { AbstractSubscriptionComponent } from '@firestone/shared/framework/common';
import { distinctUntilChanged, Observable } from 'rxjs';
import { BgsOverlayHeroOverviewService, PlayerInfo } from './bgs-overlay-hero-overview.service';

@Component({
	selector: 'bgs-hero-overview-widget-wrapper',
	styleUrls: ['./bgs-hero-overview-widget-wrapper.component.scss'],
	template: `
		<div class="container" *ngIf="hero$ | async as hero">
			<bgs-overlay-hero-overview class="overview" [config]="hero"> </bgs-overlay-hero-overview>
		</div>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BgsHeroOverviewWidgetWrapperComponent extends AbstractSubscriptionComponent implements AfterContentInit {
	hero$!: Observable<PlayerInfo>;

	constructor(protected readonly cdr: ChangeDetectorRef, private readonly controller: BgsOverlayHeroOverviewService) {
		super(cdr);
	}

	async ngAfterContentInit() {
		this.hero$ = this.controller.info$$.pipe(
			distinctUntilChanged(),
			// tap((info) => console.debug('received info in wrapper', info)),
			this.mapData((info) => info),
		);
	}
}

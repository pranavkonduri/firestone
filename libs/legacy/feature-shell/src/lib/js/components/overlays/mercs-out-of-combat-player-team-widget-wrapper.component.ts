import {
	AfterContentInit,
	ChangeDetectionStrategy,
	ChangeDetectorRef,
	Component,
	ElementRef,
	Renderer2,
	ViewRef,
} from '@angular/core';
import { SceneMode } from '@firestone-hs/reference-data';
import { SceneService } from '@firestone/memory';
import { Preferences, PreferencesService } from '@firestone/shared/common/service';
import { CardTooltipPositionType } from '@firestone/shared/common/view';
import { OverwolfService, waitForReady } from '@firestone/shared/framework/core';
import { Observable, combineLatest, distinctUntilChanged } from 'rxjs';
import { AppUiStoreFacadeService } from '../../services/ui-store/app-ui-store-facade.service';
import { AbstractWidgetWrapperComponent } from './_widget-wrapper.component';

@Component({
	selector: 'mercs-out-of-combat-player-team-widget-wrapper',
	styleUrls: ['../../../css/component/overlays/decktracker-player-widget-wrapper.component.scss'],
	template: `
		<mercenaries-out-of-combat-player-team
			class="widget"
			*ngIf="showWidget$ | async"
			cdkDrag
			[cdkDragDisabled]="!draggable"
			(cdkDragStarted)="startDragging()"
			(cdkDragReleased)="stopDragging()"
			(cdkDragEnded)="dragEnded($event)"
			[tooltipPosition]="tooltipPosition"
		></mercenaries-out-of-combat-player-team>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MercsOutOfCombatPlayerTeamWidgetWrapperComponent
	extends AbstractWidgetWrapperComponent
	implements AfterContentInit
{
	protected defaultPositionLeftProvider = (gameWidth: number, gameHeight: number) => gameWidth - 250;
	protected defaultPositionTopProvider = (gameWidth: number, gameHeight: number) => 10;
	protected positionUpdater = (left: number, top: number) =>
		this.prefs.updateMercenariesTeamPlayerPosition(left, top);
	protected positionExtractor = async (prefs: Preferences) => prefs.mercenariesPlayerTeamOverlayPosition;
	protected getRect = () => this.el.nativeElement.querySelector('.widget')?.getBoundingClientRect();
	protected bounds = {
		left: -100,
		right: -100,
		top: -50,
		bottom: -50,
	};

	tooltipPosition: CardTooltipPositionType = 'left';

	showWidget$: Observable<boolean>;

	constructor(
		protected readonly ow: OverwolfService,
		protected readonly el: ElementRef,
		protected readonly prefs: PreferencesService,
		protected readonly renderer: Renderer2,
		protected readonly store: AppUiStoreFacadeService,
		protected readonly cdr: ChangeDetectorRef,
		private readonly scene: SceneService,
	) {
		super(ow, el, prefs, renderer, cdr);
	}

	async ngAfterContentInit() {
		await waitForReady(this.scene, this.prefs);

		this.showWidget$ = combineLatest([
			this.scene.currentScene$$,
			this.prefs.preferences$$.pipe(
				this.mapData((prefs) => ({
					displayFromPrefs: prefs.mercenariesEnableOutOfCombatPlayerTeamWidget,
					displayFromPrefsVillage: prefs.mercenariesEnableOutOfCombatPlayerTeamWidgetOnVillage,
				})),
				distinctUntilChanged(
					(a, b) =>
						a.displayFromPrefs === b.displayFromPrefs &&
						a.displayFromPrefsVillage === b.displayFromPrefsVillage,
				),
			),
			this.store.listenMercenariesOutOfCombat$(([state, prefs]) => !!state),
		]).pipe(
			this.mapData(([currentScene, { displayFromPrefs, displayFromPrefsVillage }, [hasState]]) => {
				const scenes = [];
				if (displayFromPrefs) {
					scenes.push(SceneMode.LETTUCE_MAP);
				}
				if (displayFromPrefsVillage) {
					scenes.push(SceneMode.LETTUCE_BOUNTY_TEAM_SELECT, SceneMode.LETTUCE_COLLECTION);
				}
				return hasState && scenes.includes(currentScene);
			}),
			this.handleReposition(),
		);

		if (!(this.cdr as ViewRef)?.destroyed) {
			this.cdr.detectChanges();
		}
	}

	protected async reposition(cleanup?: () => void): Promise<{ left: number; top: number }> {
		const newPosition = await super.reposition(cleanup);
		if (!newPosition) {
			return;
		}

		this.tooltipPosition = newPosition.left < 400 ? 'right' : 'left';
		if (!(this.cdr as ViewRef)?.destroyed) {
			this.cdr.detectChanges();
		}
		return newPosition;
	}
}

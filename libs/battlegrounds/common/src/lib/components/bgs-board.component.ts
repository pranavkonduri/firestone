import { ComponentType } from '@angular/cdk/portal';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, HostListener, Input, OnDestroy } from '@angular/core';
import { normalizeMinionCardId } from '@firestone-hs/reference-data';
import { Entity } from '@firestone-hs/replay-parser';
import { BgsCardTooltipComponent } from '@firestone/battlegrounds/core';
import { MinionStat } from '@firestone/game-state';
import { CardsFacadeService, OverwolfService } from '@firestone/shared/framework/core';

@Component({
	selector: 'bgs-board',
	styleUrls: [`./bgs-board.component.scss`],
	template: `
		<div class="board-turn" *ngIf="showBoardMessage && customTitle">
			{{ customTitle }}
		</div>
		<div class="board-turn" *ngIf="!customTitle && _entities && !finalBoard && isNumber(currentTurn - boardTurn)">
			{{
				currentTurn - boardTurn === 0
					? ('battlegrounds.board.seen-just-now' | fsTranslate)
					: ('battlegrounds.board.seen-turns-ago' | fsTranslate: { value: currentTurn - boardTurn })
			}}
		</div>
		<div class="board-turn" *ngIf="!customTitle && _entities && finalBoard">Your final board</div>
		<div
			class="board-turn empty not-met"
			*ngIf="
				showBoardMessage &&
				!customTitle &&
				!finalBoard &&
				(!_entities || !boardTurn || !isNumber(currentTurn - boardTurn))
			"
		>
			<span [fsTranslate]="'battlegrounds.board.opponent-not-met'"></span>
		</div>
		<div
			class="board-turn empty"
			*ngIf="
				showBoardMessage &&
				!customTitle &&
				_entities &&
				_entities.length === 0 &&
				isNumber(currentTurn - boardTurn)
			"
		>
			<span [fsTranslate]="'battlegrounds.board.last-board-empty'"></span>
		</div>
		<ul class="board" *ngIf="_entities && _entities.length > 0">
			<div class="minion-container" *ngFor="let entity of _entities; trackBy: trackByEntity">
				<li>
					<card-on-board
						transition-group-item
						[entity]="entity"
						[isMainPlayer]="isMainPlayer"
						[isRecruitPhase]="isRecruitPhase"
						cachedComponentTooltip
						[componentType]="componentType"
						[componentInput]="entity"
						[componentTooltipPosition]="tooltipPosition"
					>
					</card-on-board>
				</li>
				<div class="minion-stats" *ngIf="_minionStats && _minionStats.length > 0">
					<div
						class="header"
						[helpTooltip]="
							showTooltipWarning(entity)
								? ('battlegrounds.board.stats-share-warning' | fsTranslate)
								: null
						"
						*ngIf="!hideDamageHeader"
					>
						{{ 'battlegrounds.board.total-damage' | fsTranslate }}
						<span *ngIf="showTooltipWarning(entity)">*</span>
					</div>
					<div class="values">
						<div class="damage-dealt">{{ getDamageDealt(entity) }}</div>
						<div class="damage-taken">{{ getDamageTaken(entity) }}</div>
					</div>
				</div>
			</div>
		</ul>
	`,
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BgsBoardComponent implements OnDestroy {
	componentType: ComponentType<BgsCardTooltipComponent> = BgsCardTooltipComponent;

	_entities: readonly Entity[];
	_enchantmentCandidates: readonly Entity[];
	_options: readonly number[];
	_minionStats: readonly MinionStat[];

	@Input() hideDamageHeader: boolean;
	@Input() customTitle: string;
	@Input() isMainPlayer: boolean;
	@Input() debug: boolean;
	@Input() isRecruitPhase: boolean;
	@Input() currentTurn: number;
	@Input() boardTurn: number;
	@Input() finalBoard: boolean;
	@Input() showBoardMessage = true;
	@Input() tooltipPosition: 'left' | 'right' | 'top' | 'bottom' = 'right';
	// Used when the container will scroll, so we don't want to constrain the height
	@Input() useFullWidth = false;

	@Input() set minionStats(value: readonly MinionStat[]) {
		this._minionStats = value;
	}

	@Input() set entities(value: readonly Entity[]) {
		this.inputEntities = value || [];
		this._entities = this.inputEntities.map((entity) => Entity.create({ ...entity } as Entity));
	}

	@Input() set enchantmentCandidates(value: readonly Entity[]) {
		this._enchantmentCandidates = value;
	}

	@Input() set options(value: readonly number[]) {
		this._options = value;
	}

	private inputEntities: readonly Entity[];
	private stateChangedListener: (message: any) => void;

	constructor(
		private readonly cdr: ChangeDetectorRef,
		private readonly allCards: CardsFacadeService,
		private readonly ow: OverwolfService,
	) {}

	@HostListener('window:beforeunload')
	ngOnDestroy() {
		this.ow.isOwEnabled() && this.ow.removeStateChangedListener(this.stateChangedListener);
	}

	showTooltipWarning(entity: Entity): boolean {
		return (
			this._entities
				?.map((e) => normalizeMinionCardId(e.cardID, this.allCards))
				?.filter((cardId) => cardId === normalizeMinionCardId(entity.cardID, this.allCards)).length > 1
		);
	}

	getDamageDealt(entity: Entity): number | undefined {
		return this._minionStats?.find((stat) => stat.cardId === normalizeMinionCardId(entity.cardID, this.allCards))
			?.damageDealt;
	}

	getDamageTaken(entity: Entity): number | undefined {
		return this._minionStats?.find((stat) => stat.cardId === normalizeMinionCardId(entity.cardID, this.allCards))
			?.damageTaken;
	}

	isNumber(value: number): boolean {
		return !isNaN(value);
	}

	trackByEntity(index: number, entity: Entity) {
		return entity.id;
	}

	trackByFn(index: number, item: Entity) {
		return item.id;
	}
}

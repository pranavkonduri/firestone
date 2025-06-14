import { MemoryBgsTeamInfo } from '@firestone/memory';
import { NonFunctionProperties } from '@firestone/shared/framework/common';
import { BgsGame } from './bgs-game';
import { BgsPanel } from './bgs-panel';
import { BgsPanelId } from './bgs-panel-id.type';
import { PlayerBoard } from './player-board';
import { BgsPostMatchStats } from './post-match/bgs-post-match-stats';

export class BattlegroundsState {
	// readonly inGame: boolean;
	// readonly reconnectOngoing: boolean;
	// readonly spectating: boolean;
	readonly heroSelectionDone: boolean;
	readonly panels: readonly BgsPanel[] = [];
	readonly currentGame: BgsGame | null;
	// readonly forceOpen: boolean;
	// Maybe move this elsewhere, so as not to send it everytime we emit the BattlegroundsState?
	// It is a pretty big object
	// On the other hand, it changes frequently, maybe as often as the state itself, so I'm not sure
	readonly postMatchStats: BgsPostMatchStats;

	readonly duoPendingBoards: { playerBoard: PlayerBoard; opponentBoard: PlayerBoard }[] = [];
	readonly playerTeams: MemoryBgsTeamInfo;

	public static create(base: Partial<NonFunctionProperties<BattlegroundsState>>): BattlegroundsState {
		return Object.assign(new BattlegroundsState(), base);
	}

	public update(base: Partial<NonFunctionProperties<BattlegroundsState>>): BattlegroundsState {
		return Object.assign(new BattlegroundsState(), this, base);
	}

	public updatePanel(newPanel: BgsPanel): BattlegroundsState {
		const panels: readonly BgsPanel[] = this.panels.map((panel) => (panel.id === newPanel.id ? newPanel : panel));
		return this.update({
			panels: panels,
		} as BattlegroundsState);
	}

	public getPanel(panelId: BgsPanelId): BgsPanel | undefined {
		return this.panels.find((panel) => panel.id === panelId);
	}
}

import { Injectable } from '@angular/core';
import { DeckCard, DeckState, EntityGameState, PlayerGameState } from '@firestone/game-state';
import { arraysEqual } from '@firestone/shared/framework/common';

@Injectable()
export class ZoneOrderingService {
	// This could be completely removed by support the "POSITION_IN_ZONE" tag and tag changes
	public orderZones(deckState: DeckState, stateFromTracker: PlayerGameState): DeckState {
		if (!stateFromTracker) {
			return deckState;
		}

		const newBoard = stateFromTracker.Board
			? this.orderZone(deckState.board, stateFromTracker.Board)
			: deckState.board;
		const newHand = stateFromTracker.Hand ? this.orderZone(deckState.hand, stateFromTracker.Hand) : deckState.hand;

		const hasChanged = !arraysEqual(newBoard, deckState.board) || !arraysEqual(newHand, deckState.hand);

		return hasChanged
			? deckState.update({
					board: newBoard,
					hand: newHand,
			  })
			: deckState;
	}

	private orderZone(zone: readonly DeckCard[], stateFromTracker: readonly EntityGameState[]): readonly DeckCard[] {
		if (zone.length !== stateFromTracker.length) {
			return zone;
		}

		// The tracker state is already correclty ordered
		const sorted = Array(stateFromTracker.length).fill(null);
		for (let i = 0; i < stateFromTracker.length; i++) {
			sorted[i] = zone.find((card) => card.entityId === stateFromTracker[i].entityId);
			if (!sorted[i]) {
				// console.warn('Could not find card in zone while ordering', stateFromTracker[i], zone);
				return zone;
			}
		}

		return sorted;
	}
}

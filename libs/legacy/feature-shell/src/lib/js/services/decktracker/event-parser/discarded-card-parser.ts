import { DeckCard, DeckState, GameState } from '@firestone/game-state';
import { CardsFacadeService } from '@firestone/shared/framework/core';
import { GameEvent } from '../../../models/game-event';
import { DeckManipulationHelper } from './deck-manipulation-helper';
import { EventParser } from './event-parser';

export class DiscardedCardParser implements EventParser {
	constructor(private readonly helper: DeckManipulationHelper, private readonly allCards: CardsFacadeService) {}

	applies(gameEvent: GameEvent, state: GameState): boolean {
		return !!state;
	}

	async parse(currentState: GameState, gameEvent: GameEvent): Promise<GameState> {
		const [cardId, controllerId, localPlayer, entityId] = gameEvent.parse();

		const isPlayer = controllerId === localPlayer.PlayerId;
		const deck = isPlayer ? currentState.playerDeck : currentState.opponentDeck;
		const card = this.helper.findCardInZone(deck.hand, cardId, entityId);

		const [newHand, removedCard] = this.helper.removeSingleCardFromZone(deck.hand, card.cardId, entityId);

		// See card-played-from-hand
		let newDeck = deck.deck; // this.helper.updateDeckForAi(gameEvent, currentState, removedCard);

		// See card-played-from-hand
		if (!removedCard?.cardId && cardId && !gameEvent.additionalData?.transientCard) {
			const [newDeckAfterReveal, removedCardFromDeck] = this.helper.removeSingleCardFromZone(
				newDeck,
				cardId,
				entityId,
				deck.deckList.length === 0,
			);

			if (removedCardFromDeck) {
				newDeck = newDeckAfterReveal;
			}
		}

		let board = deck.board;
		if (!!gameEvent.additionalData.originEntityId) {
			const originCard = board.find((e) => e.entityId === gameEvent.additionalData.originEntityId);
			const newOriginCard: DeckCard = !originCard
				? null
				: originCard.update({
						relatedCardIds: [cardId, ...(originCard.relatedCardIds ?? [])],
				  });
			board = !newOriginCard ? board : this.helper.replaceCardInZone(board, newOriginCard);
		}

		const cardWithZone = card.update({
			zone: 'DISCARD',
		} as DeckCard);
		const newOther: readonly DeckCard[] = this.helper.addSingleCardToOtherZone(
			deck.otherZone,
			cardWithZone,
			this.allCards,
		);
		const newPlayerDeck = Object.assign(new DeckState(), deck, {
			hand: newHand,
			otherZone: newOther,
			deck: newDeck,
			board: board,
		} as DeckState);
		return Object.assign(new GameState(), currentState, {
			[isPlayer ? 'playerDeck' : 'opponentDeck']: newPlayerDeck,
		});
	}

	event(): string {
		return GameEvent.DISCARD_CARD;
	}
}

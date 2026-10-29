import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { TuiButton } from '@taiga-ui/core';
import { TuiButtonLoading } from '@taiga-ui/kit';

import { ApiErrorCode, hasApiErrorCode, isApiError } from '../../../../api/http';
import { NotificationsService } from '../../../../api/notifications.service';
import { UserService } from '../../../../api/user.service';

// Подписка имеет смысл, пока серии ещё выходят. Вышедший тайтл бэк сам
// снимает с подписки и присылает «вышло полностью».
const SUBSCRIBABLE_STATUSES = new Set(['ongoing', 'announcement']);

/** Подтверждение почты живёт на сайте: в приложении профиля нет. */
const EMAIL_HINT =
  'Подтвердите почту, чтобы получать уведомления. Письмо можно отправить ещё раз в профиле на anion.online.';

/** Уведомления о новых сериях: компактный колокольчик рядом с закладкой. */
@Component({
  selector: 'app-subscribe-button',
  imports: [TuiButton, TuiButtonLoading],
  template: `
    @if (visible()) {
      <button
        tuiIconButton
        type="button"
        size="s"
        class="subscribe"
        [appearance]="subscribed() ? 'secondary' : 'outline-grayscale'"
        [iconStart]="subscribed() ? '@tui.bell-ring' : '@tui.bell'"
        [loading]="subscribed() === null || busy()"
        [attr.aria-pressed]="subscribed()"
        [attr.aria-label]="subscribed() ? 'Отключить уведомления о новых сериях' : 'Уведомлять о новых сериях'"
        [title]="
          subscribed()
            ? 'Уведомления о новых сериях включены. Нажмите, чтобы отключить.'
            : locked()
              ? 'Подтвердите почту, чтобы получать уведомления'
              : 'Уведомлять о новых сериях'
        "
        (click)="toggle()"
      >
      </button>
    }
  `,
  styleUrl: './subscribe-button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SubscribeButtonComponent {
  readonly animeId = input.required<number>();
  readonly statusAlias = input<string | undefined>('');

  private readonly user = inject(UserService);
  private readonly notifications = inject(NotificationsService);

  protected readonly visible = computed(
    () =>
      this.user.isAuthenticated() &&
      SUBSCRIBABLE_STATUSES.has(this.statusAlias() ?? '')
  );
  /** null — состояние ещё не загружено. */
  protected readonly subscribed = signal<boolean | null>(null);
  protected readonly busy = signal(false);
  /** Новая подписка закрыта, пока почта не подтверждена; отписаться можно всегда. */
  protected readonly locked = computed(
    () => !this.user.isEmailVerified() && this.subscribed() !== true
  );
  /** Что пошло не так — показывает родитель, у него место под строку. */
  readonly failed = output<string>();

  constructor() {
    // Состояние подписки грузим заново при переходе на другое аниме.
    effect(() => {
      const animeId = this.animeId();
      if (!this.visible()) return;

      untracked(() => this.subscribed.set(null));
      this.notifications
        .isSubscribed(animeId)
        .then((subscribed) => {
          if (this.animeId() === animeId) this.subscribed.set(subscribed);
        })
        .catch(() => {
          if (this.animeId() === animeId) this.subscribed.set(false);
        });
    });
  }

  protected async toggle(): Promise<void> {
    const current = this.subscribed();
    if (current === null || this.busy()) return;

    if (this.locked()) {
      this.failed.emit(EMAIL_HINT);
      return;
    }

    this.busy.set(true);
    this.failed.emit('');
    try {
      this.subscribed.set(
        await this.notifications.setSubscribed(this.animeId(), !current)
      );
    } catch (error: unknown) {
      // Состояние не поменялось — кнопка остаётся как была, причину объясняем.
      if (hasApiErrorCode(error, ApiErrorCode.EmailNotVerified)) {
        this.user.markEmailUnverified();
        this.failed.emit(EMAIL_HINT);
      } else if (hasApiErrorCode(error, ApiErrorCode.SubscriptionLimit)) {
        this.failed.emit(
          'Подписок слишком много. Отпишитесь от тайтлов, которые больше не ждёте.'
        );
      } else if (isApiError(error) && error.status === 404) {
        this.failed.emit(
          'Этого тайтла больше нет в каталоге — подписаться не получится.'
        );
      } else {
        this.failed.emit(
          current
            ? 'Не удалось отписаться. Попробуйте ещё раз.'
            : 'Не удалось подписаться. Попробуйте ещё раз.'
        );
      }
    } finally {
      this.busy.set(false);
    }
  }
}

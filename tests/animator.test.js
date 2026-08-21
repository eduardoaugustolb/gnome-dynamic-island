import {Animator} from '../core/animator.js';
import {assertEqual, assertFalse, assertTrue} from './lib/assert.js';

function actor() {
    return {
        transitionsRemoved: 0,
        eased: null,
        remove_all_transitions() { this.transitionsRemoved++; },
        remove_transition(name) { this.removed = name; },
        ease(options) { this.eased = options; },
    };
}

export const tests = {
    'Animator começa habilitado e alterna preferência'() {
        const animator = new Animator();
        assertTrue(animator.enabled);
        animator.setEnabled(false);
        assertFalse(animator.enabled);
    },

    'animate sem animação aplica propriedades e callback imediatamente'() {
        const animator = new Animator({enabled: false});
        const target = actor();
        let completed = false;
        animator.animate(target, {opacity: 255, width: 420}, {
            duration: 300,
            onComplete: () => completed = true,
        });
        assertEqual(target.opacity, 255);
        assertEqual(target.width, 420);
        assertTrue(completed);
        assertEqual(target.transitionsRemoved, 1);
        assertEqual(target.eased, null);
    },

    'animate com duração zero também evita ease'() {
        const animator = new Animator();
        const target = actor();
        animator.animate(target, {translation_x: -20}, {duration: 0});
        assertEqual(target.translation_x, -20);
        assertEqual(target.eased, null);
    },

    'animate habilitado passa easing, delay e estado inicial ao ator'() {
        const animator = new Animator();
        const target = actor();
        animator.animate(target, {opacity: 255}, {
            duration: 200,
            delay: 10,
            initial: {opacity: 0},
        });
        assertEqual(target.opacity, 0);
        assertEqual(target.eased.duration, 200);
        assertEqual(target.eased.delay, 10);
        assertEqual(target.transitionsRemoved, 1);
    },

    'clear, stop e loop delegam ao ator'() {
        const animator = new Animator();
        const target = actor();
        animator.clear(target);
        animator.stop(target, 'rotation-angle-z');
        animator.loop(target, {rotation_angle_z: 360});
        assertEqual(target.transitionsRemoved, 2);
        assertEqual(target.removed, 'rotation-angle-z');
        assertEqual(target.eased.rotation_angle_z, 360);
    },
};
